"""ResultStore adapter: writes pipeline outputs to Supabase Postgres/PostGIS with COPY (fast, transactional).

Uses the least-privilege `floodograph_loader` role (SUPABASE_DB_URL in pipeline/.env).
"""
from __future__ import annotations

import geopandas as gpd
import psycopg
from shapely.geometry import MultiLineString, MultiPolygon, box
from shapely import wkb

from ..config import CityConfig, db_url


def _multi(g):
    if g.geom_type == "Polygon":
        return MultiPolygon([g])
    if g.geom_type == "LineString":
        return MultiLineString([g])
    if g.geom_type == "GeometryCollection":
        lines = [x for x in g.geoms if x.geom_type == "LineString"]
        return MultiLineString(lines) if lines else None
    return g


def _ewkb(g) -> str:
    return wkb.dumps(g, hex=True, srid=4326)


class PostgisStore:
    def __init__(self, url: str | None = None):
        self.url = url or db_url()
        if not self.url:
            raise RuntimeError("SUPABASE_DB_URL missing in pipeline/.env")

    def replace_city(self, city: CityConfig, buildings: gpd.GeoDataFrame, corridors: gpd.GeoDataFrame) -> dict:
        """Atomically replace one city's static layers (city row, buildings, corridors)."""
        b = buildings.to_crs(4326)
        c = corridors.to_crs(4326)
        bbox = box(*city.bbox)
        cx, cy = bbox.centroid.x, bbox.centroid.y
        with psycopg.connect(self.url) as conn, conn.transaction():
            conn.execute("delete from public.corridors where city_id = %s", (city.id,))
            conn.execute("delete from public.buildings where city_id = %s", (city.id,))
            conn.execute(
                """insert into public.cities (id, name, epsg, bbox, center, res_m)
                   values (%s, %s, %s, extensions.st_geomfromewkb(decode(%s,'hex')),
                           extensions.st_setsrid(extensions.st_point(%s, %s), 4326), %s)
                   on conflict (id) do update set name = excluded.name, epsg = excluded.epsg,
                     bbox = excluded.bbox, center = excluded.center, res_m = excluded.res_m""",
                (city.id, city.name, city.epsg, _ewkb(bbox), cx, cy, city.res_m),
            )
            # COPY is not allowed on RLS tables for non-bypass roles: stage into a temp table, then
            # INSERT ... SELECT (which is checked against the "loader write" policy).
            conn.execute("create temp table _b (like public.buildings including defaults) on commit drop")
            with conn.cursor().copy(
                "copy _b (id, city_id, osm_id, geom, height_m, hand_m, critical) from stdin"
            ) as cp:
                for r in b.itertuples(index=False):
                    g = _multi(r.geometry)
                    if g is None or g.is_empty:
                        continue
                    cp.write_row((int(r.osm_id), city.id, int(r.osm_id), _ewkb(g), float(r.height_m),
                                  None if r.hand_m != r.hand_m else float(r.hand_m),
                                  r.critical if isinstance(r.critical, str) else None))
            conn.execute("insert into public.buildings select * from _b on conflict (id) do nothing")
            id_offset = (sum(map(ord, city.id)) % 1000) * 1_000_000  # deterministic, unique across cities
            conn.execute("create temp table _c (like public.corridors including defaults) on commit drop")
            with conn.cursor().copy(
                "copy _c (id, city_id, geom, kind, upstream_km2, min_hand, tier, "
                "buildings_at_risk, critical_count) from stdin"
            ) as cp:
                for r in c.itertuples(index=False):
                    g = _multi(r.geometry)
                    if g is None or g.is_empty:
                        continue
                    cp.write_row((id_offset + int(r.id), city.id, _ewkb(g), r.kind, float(r.upstream_km2),
                                  None if r.min_hand != r.min_hand else float(r.min_hand), r.tier,
                                  int(r.buildings_at_risk), int(r.critical_count)))
            conn.execute("insert into public.corridors select * from _c")
            n_b = conn.execute("select count(*) from public.buildings where city_id=%s", (city.id,)).fetchone()[0]
            n_c = conn.execute("select count(*) from public.corridors where city_id=%s", (city.id,)).fetchone()[0]
        return {"buildings": n_b, "corridors": n_c}
