"""Pipeline steps (Pipes & Filters). Each step is cached on disk; see floodograph/cache.py."""
from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import shape

from ..adapters import osm, overture
from ..adapters.dem import CopernicusSource, FabdemSource, load_dem
from ..cache import cached
from ..config import CityConfig
from ..core.hydrology import drainage_network, sample
from ..core.tiers import tier_index, tier_names

HYDRO_RES_M = 30  # native resolution of FABDEM / Copernicus GLO-30
CORRIDOR_BUFFER_M = 60  # building within this distance of a corridor counts as "on" it
BURIED_MATCH_M = 40  # derived corridor counts as a mapped stream if it runs within this distance


@cached("dem")
def dem(city: CityConfig, source: str = "fabdem"):
    src = FabdemSource() if source == "fabdem" else CopernicusSource()
    return load_dem(src, city.hydro_bbox, city.epsg, HYDRO_RES_M)


@cached("hydro")
def hydro(city: CityConfig, stream_threshold_km2: float = 0.25):
    return drainage_network(dem(city), stream_threshold_km2)


@cached("osm")
def osm_layers(city: CityConfig):
    return {
        "buildings": osm.buildings(city.bbox),
        "critical": osm.critical_facilities(city.bbox),
        "waterways": osm.waterways(city.hydro_bbox),
    }


@cached("footprints")
def building_footprints(city: CityConfig) -> gpd.GeoDataFrame:
    """Overture buildings (OSM + ML footprints), keeping OSM height/levels tags where OSM has the building."""
    osm_b = osm_layers(city)["buildings"]
    heights = osm_b.drop_duplicates("osm_id").set_index("osm_id")["height_m"]
    return overture.buildings(city.bbox, city.data_dir / "cache", heights)


def _aoi(city: CityConfig) -> gpd.GeoSeries:
    from shapely.geometry import box

    return gpd.GeoSeries([box(*city.bbox)], crs=4326)


OVERLAP_SHARE = 0.2  # footprints overlapping by more than this share of the smaller one are one building


def overlap_groups(geoms: gpd.GeoSeries) -> np.ndarray:
    """Group ids for footprints that are really one building drawn as several overlapping polygons
    (OSM outlines with nested blocks / wings). Shared walls between row houses (zero-area contact) do not count."""
    import shapely
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    g = geoms.values
    n = len(g)
    tree = shapely.STRtree(g)
    i, j = tree.query(g, predicate="intersects")
    keep = i < j
    i, j = i[keep], j[keep]
    if len(i):
        inter = shapely.area(shapely.intersection(g[i], g[j]))
        area = shapely.area(g)
        same = inter > OVERLAP_SHARE * np.minimum(area[i], area[j])
        i, j = i[same], j[same]
    graph = coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n))
    _, labels = connected_components(graph, directed=False)
    return labels


def buildings(city: CityConfig) -> gpd.GeoDataFrame:
    """Buildings with HAND (lowest point of the footprint), critical facility tag and urgency tier."""
    h, _ = hydro(city)
    layers = osm_layers(city)
    b = building_footprints(city).to_crs(city.epsg).copy()

    # HAND of a building = minimum over its footprint vertices and centroid (water reaches the lowest wall first)
    pts = b.geometry.apply(lambda g: np.vstack([np.asarray(g.centroid.coords),
                                                np.asarray(g.convex_hull.exterior.coords)])
                           if g.geom_type in ("Polygon", "MultiPolygon") else np.asarray(g.centroid.coords))
    owner = np.repeat(np.arange(len(b)), pts.apply(len).to_numpy())
    xy = np.vstack(pts.to_list())
    vals = sample(h.hand, xy[:, 0], xy[:, 1])
    hand = pd.Series(vals).groupby(owner).min().reindex(range(len(b))).to_numpy()
    b["hand_m"] = np.round(hand, 2)

    # Critical facilities: facility geometry intersects the building footprint
    crit = layers["critical"].to_crs(city.epsg)
    if len(crit):
        j = gpd.sjoin(b[["geometry"]], crit[["critical", "geometry"]], how="left", predicate="intersects")
        b["critical"] = j.groupby(level=0)["critical"].first().reindex(b.index)
    else:
        b["critical"] = None

    # One building drawn as several overlapping polygons gets one answer: the lowest HAND of its parts (water
    # enters at the lowest wall) and its critical tag, so a tower is never half "acil" and half "izle".
    b["grp"] = overlap_groups(b.geometry)
    grouped = b.groupby("grp")
    b["hand_m"] = grouped["hand_m"].transform("min")
    b["critical"] = grouped["critical"].transform(lambda s: s.dropna().iloc[0] if s.notna().any() else None)

    b["tier"] = tier_names(tier_index(b["hand_m"].to_numpy(), b["critical"].notna().to_numpy()))
    return b.to_crs(4326)


def corridors(city: CityConfig, b: gpd.GeoDataFrame | None = None) -> gpd.GeoDataFrame:
    """Drainage corridors from the DEM, classified against OSM waterways and scored by exposure."""
    h, network = hydro(city)
    lines = gpd.GeoDataFrame(
        geometry=[shape(f["geometry"]) for f in network["features"]], crs=city.epsg
    )
    # upstream area (km²) = max flow accumulation sampled along the segment
    acc_km2 = []
    for geom in lines.geometry:
        xs, ys = np.asarray(geom.coords).T
        acc_km2.append(float(np.nanmax(sample(h.acc, xs, ys))) * (h.acc.cell**2) / 1e6)
    lines["upstream_km2"] = np.round(acc_km2, 3)

    aoi = _aoi(city).to_crs(city.epsg).iloc[0]
    lines = lines[lines.intersects(aoi)].copy()
    lines["geometry"] = lines.geometry.intersection(aoi)
    lines = lines[~lines.geometry.is_empty & (lines.geometry.length > 30)].reset_index(drop=True)

    # Classify: mapped buried (OSM culvert/tunnel), mapped open stream, or derived (no mapped stream = lost stream candidate)
    ww = osm_layers(city)["waterways"].to_crs(city.epsg)
    kind = np.full(len(lines), "derived", dtype=object)
    for is_buried, label in ((False, "open"), (True, "buried_osm")):
        sel = ww[ww["buried"] == is_buried]
        if len(sel):
            zone = sel.buffer(BURIED_MATCH_M).union_all()
            frac = lines.geometry.intersection(zone).length / lines.geometry.length
            kind[(frac > 0.4).to_numpy()] = label
    lines["kind"] = kind

    # Exposure: buildings within CORRIDOR_BUFFER_M of each corridor
    if b is None:
        b = buildings(city)
    if len(b) == 0:
        # city-wide run without analysed buildings: classification only, no exposure ranking
        lines["buildings_at_risk"] = 0
        lines["critical_count"] = 0
        lines["min_hand"] = np.nan
        lines["tier"] = "izle"
        lines["id"] = np.arange(1, len(lines) + 1)
        return lines.to_crs(4326)
    bp = b.to_crs(city.epsg)
    zones = gpd.GeoDataFrame({"cid": lines.index}, geometry=lines.buffer(CORRIDOR_BUFFER_M), crs=city.epsg)
    j = gpd.sjoin(bp[["hand_m", "critical", "tier", "geometry"]], zones, predicate="intersects")
    at_risk = j[j["tier"].isin(["acil", "yuksek"])]
    lines["buildings_at_risk"] = at_risk.groupby("cid").size().reindex(lines.index, fill_value=0).astype(int)
    lines["critical_count"] = j[j["critical"].notna()].groupby("cid").size().reindex(lines.index, fill_value=0).astype(int)
    lines["min_hand"] = j.groupby("cid")["hand_m"].min().reindex(lines.index)
    # Corridor tier by how many buildings it threatens (prioritisation must discriminate):
    #   acil   >= 25 urgent buildings, or an urgent critical facility on it
    #   yuksek >= 5 urgent or >= 15 high-tier buildings
    #   orta   any urgent/high building;  izle otherwise
    n_acil = j[j["tier"] == "acil"].groupby("cid").size().reindex(lines.index, fill_value=0)
    n_yuk = j[j["tier"] == "yuksek"].groupby("cid").size().reindex(lines.index, fill_value=0)
    crit_acil = j[(j["tier"] == "acil") & j["critical"].notna()].groupby("cid").size().reindex(lines.index, fill_value=0)
    t = np.full(len(lines), 3)
    t[(n_acil + n_yuk > 0).to_numpy()] = 2
    t[((n_acil >= 5) | (n_yuk >= 15)).to_numpy()] = 1
    t[((n_acil >= 25) | (crit_acil > 0)).to_numpy()] = 0
    lines["tier"] = tier_names(t)
    lines["id"] = np.arange(1, len(lines) + 1)
    return lines.to_crs(4326)
