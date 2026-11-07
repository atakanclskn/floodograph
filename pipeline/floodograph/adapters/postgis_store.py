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

    @staticmethod
    def _stage_copy(conn, table: str, cols: list[str], rows) -> None:
        """COPY into a temp clone (RLS forbids COPY on the real table), then INSERT ... SELECT."""
        tmp = f"_stage_{table}"
        conn.execute(f"create temp table {tmp} (like public.{table} including defaults) on commit drop")
        with conn.cursor().copy(f"copy {tmp} ({', '.join(cols)}) from stdin") as cp:
            for r in rows:
                cp.write_row(r)
        conn.execute(f"insert into public.{table} ({', '.join(cols)}) select {', '.join(cols)} from {tmp}")

    def replace_scenario(self, city: CityConfig, summary: dict, rain_mm: list[float], rain_step_min: int,
                         impacts, frames_dir, label: str, kind: str = "historical", step_min: int = 5) -> dict:
        """Replace one scenario: metadata, rain series, per-building impacts and binary frames."""
        import json
        from pathlib import Path

        sid = summary["scenario"]
        aoi_m2 = gpd.GeoSeries([box(*city.bbox)], crs=4326).to_crs(city.epsg).area.iloc[0]
        total_m3 = summary["total_mm"] / 1000 * aoi_m2
        start = None if summary["start"] == "design" else summary["start"] + ":00+03:00"
        timeline = {x["t_min"]: x for x in summary.get("timeline", [])}
        frames = sorted(Path(frames_dir).glob("*.bin"), key=lambda p: int(p.stem))
        with psycopg.connect(self.url) as conn, conn.transaction():
            conn.execute("delete from public.scenarios where id = %s", (sid,))
            conn.execute(
                """insert into public.scenarios (id, city_id, kind, label, rain_source, start_ts, step_min,
                     duration_min, total_mm, total_m3, params, metrics)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (sid, city.id, kind, label, summary["rain_source"], start, step_min,
                 int(len(rain_mm) * rain_step_min), summary["total_mm"], total_m3,
                 json.dumps({"grid": summary["grid"], "physics": summary["params"]}),
                 json.dumps({**summary["results"], "mass_balance_rel_error": summary["mass_balance"]["relative_error"],
                             "peak_mm_h": summary["peak_mm_h"]})),
            )
            self._stage_copy(conn, "rain_series", ["scenario_id", "t_min", "mm"],
                             ((sid, i * rain_step_min, float(v)) for i, v in enumerate(rain_mm)))
            self._stage_copy(
                conn, "building_impacts", ["scenario_id", "building_id", "first_wet_min", "max_depth_m", "tier"],
                ((sid, int(r.osm_id), None if r.first_wet_min != r.first_wet_min else int(r.first_wet_min),
                  float(r.max_depth_m), r.tier) for r in impacts.itertuples(index=False)))
            self._stage_copy(
                conn, "grid_frames", ["scenario_id", "t_min", "storage_path", "max_depth", "wet_cells", "data"],
                ((sid, int(p.stem), "db", float(timeline.get(int(p.stem), {}).get("max_depth", 0.0)),
                  0, p.read_bytes()) for p in frames))
            n = conn.execute("select count(*), coalesce(sum(length(data)),0) from public.grid_frames where scenario_id=%s",
                             (sid,)).fetchone()
            nb = conn.execute("select count(*) from public.building_impacts where scenario_id=%s", (sid,)).fetchone()[0]
        return {"frames": n[0], "frames_mb": round(n[1] / 1e6, 1), "impacts": nb}
