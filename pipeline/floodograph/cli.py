"""Command line entry: `uv run floodograph static --city istanbul [--upload] [--preview]`."""
from __future__ import annotations

import argparse
import json
import time

from .config import DATA_DIR, load_cities


def cmd_static(args: argparse.Namespace) -> None:
    from .pipeline import steps

    cities = load_cities()
    for cid in args.city:
        city = cities[cid]
        t = time.time()
        h, _ = steps.hydro(city)
        b = steps.buildings(city)
        c = steps.corridors(city, b)
        km = (c.to_crs(city.epsg).length / 1000).groupby(c.kind).sum().round(2).to_dict()
        summary = {
            "city": cid,
            "buildings": len(b),
            "building_tiers": b.tier.value_counts().to_dict(),
            "critical_buildings": b.critical.value_counts().to_dict(),
            "corridors": len(c),
            "corridor_tiers": c.tier.value_counts().to_dict(),
            "corridor_km_by_kind": km,
            "hydro": h.meta,
            "seconds": round(time.time() - t, 1),
        }
        out_dir = DATA_DIR / cid
        b.to_file(out_dir / "buildings.geojson", driver="GeoJSON")
        c.to_file(out_dir / "corridors.geojson", driver="GeoJSON")
        if args.preview:
            from .preview import render

            summary["preview"] = str(render(city, h, b, c, out_dir / "preview_static.png"))
        if args.upload:
            from .adapters.postgis_store import PostgisStore

            summary["uploaded"] = PostgisStore().replace_city(city, b, c)
        print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))


def cmd_simulate(args: argparse.Namespace) -> None:
    from .adapters.open_meteo import HistoricalRain
    from .pipeline.simulate import run_scenario

    from .pipeline.calibrate import shape_rain
    from .pipeline.simulate import RAIN_SHARPEN, RAIN_SHIFT_H

    city = load_cities()[args.city]
    rain = shape_rain(HistoricalRain(args.start, args.hours, station_total_mm=args.station_mm,
                                     station_note=args.station_note).series(*city.rain_point), RAIN_SHIFT_H, RAIN_SHARPEN)
    s = run_scenario(city, args.scenario, rain, res_m=args.res, backend=args.backend)
    s.pop("timeline", None)
    print(json.dumps(s, ensure_ascii=False, indent=2, default=str))


def cmd_upload_scenario(args: argparse.Namespace) -> None:
    import pandas as pd

    from .adapters.open_meteo import HistoricalRain
    from .adapters.postgis_store import PostgisStore
    from .core.tiers import scenario_tier_index, tier_index, tier_names
    from .pipeline import steps

    city = load_cities()[args.city]
    out = city.data_dir / "scenarios" / args.scenario
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    from .pipeline.calibrate import shape_rain
    from .pipeline.simulate import RAIN_SHARPEN, RAIN_SHIFT_H

    rain = shape_rain(HistoricalRain(args.start, args.hours, station_total_mm=args.station_mm,
                                     station_note=args.station_note).series(*city.rain_point), RAIN_SHIFT_H, RAIN_SHARPEN)
    imp = pd.read_csv(out / "impacts.csv")
    b = steps.buildings(city)[["osm_id", "hand_m", "critical", "grp"]]
    imp = imp.merge(b, on="osm_id", how="left")
    # parts of one building (overlapping footprints) share the earliest wetting and the deepest water
    g = imp.groupby("grp")
    imp["first_wet_min"] = g["first_wet_min"].transform("min")
    imp["max_depth_m"] = g["max_depth_m"].transform("max")
    crit = imp["critical"].notna().to_numpy()
    static_idx = tier_index(imp["hand_m"].to_numpy(), crit)
    imp["tier"] = tier_names(scenario_tier_index(imp["max_depth_m"].to_numpy(), crit, static_idx))
    res = PostgisStore().replace_scenario(city, summary, rain.mm.tolist(), rain.step_min, imp, out / "frames",
                                          label=args.label)
    res["tiers"] = imp["tier"].value_counts().to_dict()
    print(json.dumps(res, ensure_ascii=False, indent=2))


def cmd_city(args: argparse.Namespace) -> None:
    """Whole-city run: simulate on the GPU, then (optionally) upload city row + scenario frames."""
    import geopandas as gpd
    import pandas as pd

    from .adapters.open_meteo import HistoricalRain
    from .pipeline.simulate_city import run_city

    for cid in args.city:
        city = load_cities()[cid]
        rain = HistoricalRain(args.start, args.hours, station_total_mm=args.station_mm,
                              station_note=args.station_note).series(*city.rain_point)
        sid = f"{cid}-2026-10-14"
        s = run_city(city, sid, rain, res_m=city.res_m, backend=args.backend)
        if args.upload:
            from .adapters.postgis_store import PostgisStore

            store = PostgisStore()
            empty = gpd.GeoDataFrame({"osm_id": [], "height_m": [], "hand_m": [], "critical": [], "tier": []},
                                     geometry=[], crs=4326)
            store.replace_city(city, empty, gpd.GeoDataFrame(geometry=[], crs=4326))
            out = city.data_dir / "scenarios" / sid
            imp = pd.DataFrame({"osm_id": [], "first_wet_min": [], "max_depth_m": [], "tier": []})
            s["uploaded"] = store.replace_scenario(city, s, rain.mm.tolist(), rain.step_min, imp, out / "frames",
                                                   label=f"14 Ekim 2026 yağışı · {city.name}", step_min=30)
        s.pop("timeline", None)
        print(json.dumps(s, ensure_ascii=False, indent=2, default=str), flush=True)


def cmd_corridors(args: argparse.Namespace) -> None:
    """City-wide drainage corridors (lost / buried / open streams) without building exposure.
    Parts inside the --exclude city's pilot area are cut away (that area has its own building-scored corridors)."""
    import geopandas as gpd
    from shapely.geometry import box

    from .pipeline import steps

    cities = load_cities()
    city = cities[args.city]
    t = time.time()
    empty = gpd.GeoDataFrame({"osm_id": [], "height_m": [], "hand_m": [], "critical": [], "tier": []},
                             geometry=[], crs=4326)
    c = steps.corridors(city, empty)
    if args.exclude:
        hole = gpd.GeoSeries([box(*cities[args.exclude].bbox)], crs=4326).to_crs(city.epsg).iloc[0]
        cc = c.to_crs(city.epsg)
        cc["geometry"] = cc.geometry.difference(hole).simplify(8)
        cc = cc[~cc.geometry.is_empty & (cc.geometry.length > 30)].reset_index(drop=True)
        cc["id"] = range(1, len(cc) + 1)
        c = cc.to_crs(4326)
    km = (c.to_crs(city.epsg).length / 1000).groupby(c.kind).sum().round(1).to_dict()
    summary = {"city": city.id, "corridors": len(c), "by_kind": c.kind.value_counts().to_dict(), "km_by_kind": km,
               "seconds": round(time.time() - t, 1)}
    c.to_file(city.data_dir / "corridors.geojson", driver="GeoJSON")
    if args.upload:
        from .adapters.postgis_store import PostgisStore

        summary["uploaded"] = PostgisStore().replace_city(city, empty, c)
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))


def cmd_merkez(args: argparse.Namespace) -> None:
    from .pipeline.merkez import run_merkez, upload_merkez

    cities = load_cities()
    for cid in args.city:
        meta = run_merkez(cities[cid])
        if args.upload:
            meta["uploaded"] = upload_merkez(cities[cid])
        print(json.dumps({k: v for k, v in meta.items() if k != "grid"}, ensure_ascii=False, default=str), flush=True)


def cmd_corridor_tiles(args: argparse.Namespace) -> None:
    """Tile the city-wide corridors into apps/web/public/corridors for viewport-only loading."""
    from .config import ROOT
    from .pipeline.corridor_tiles import write_tiles

    import geopandas as gpd

    from .pipeline import steps

    cities = load_cities()
    sources = {}
    for c in args.city:
        path = cities[c].data_dir / "corridors.geojson"
        if path.exists():
            # older corridor files were made before the sea cut: apply it here too (idempotent)
            sources[c] = steps.land_only(cities[c], gpd.read_file(path))
    out = ROOT.parent / "apps" / "web" / "public" / "corridors"
    print(json.dumps(write_tiles(sources, out), ensure_ascii=False, indent=2))


def cmd_ladder(args: argparse.Namespace) -> None:
    """Rain-level ladders for /sehirler, regions uploaded separately for viewport loading."""
    from .pipeline.rain_ladder import run_ladder, upload_ladder

    cities = load_cities()
    for cid in args.city:
        meta = run_ladder(cities[cid], args.loss, args.sharpen, args.shift)
        res = {"city": cid, "regions": len(meta["regions"]), "report": meta["report"], "seconds": meta["seconds"]}
        if args.upload:
            res["uploaded"] = upload_ladder(cities[cid])
        print(json.dumps(res, ensure_ascii=False, indent=2), flush=True)


def cmd_calibrate(args: argparse.Namespace) -> None:
    from .pipeline.calibrate import calibrate

    df = calibrate(load_cities()[args.city])
    print(df.sort_values("score").head(8).to_string(index=False))


def main() -> None:
    p = argparse.ArgumentParser(prog="floodograph")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("static", help="DEM → HAND → corridors → buildings (optionally upload)")
    s.add_argument("--city", nargs="+", default=["istanbul"])
    s.add_argument("--upload", action="store_true")
    s.add_argument("--preview", action="store_true")
    s.set_defaults(func=cmd_static)
    m = sub.add_parser("simulate", help="2D shallow-water simulation of a historical rain event")
    m.add_argument("--city", default="istanbul")
    m.add_argument("--scenario", default="istanbul-2026-10-14")
    m.add_argument("--start", default="2026-10-14T06:00")
    m.add_argument("--hours", type=int, default=30)
    m.add_argument("--station-mm", type=float, default=188.0)
    m.add_argument("--station-note", default="Sarıyer istasyonu 187,9 mm (İBB, 14 Ekim 2026)")
    m.add_argument("--res", type=float, default=20.0)
    m.add_argument("--backend", choices=["auto", "cpu", "gpu"], default="auto",
                   help="solver: CUDA when available (auto), or force the numba CPU reference")
    m.set_defaults(func=cmd_simulate)
    u = sub.add_parser("upload-scenario", help="Upload a simulated scenario (impacts, rain, frames) to Supabase")
    u.add_argument("--city", default="istanbul")
    u.add_argument("--scenario", default="istanbul-2026-10-14")
    u.add_argument("--label", default="14 Ekim 2026 · gözlenen yağış (Sarıyer 188 mm, kalibre)")
    u.add_argument("--start", default="2026-10-14T06:00")
    u.add_argument("--hours", type=int, default=30)
    u.add_argument("--station-mm", type=float, default=188.0)
    u.add_argument("--station-note", default="Sarıyer istasyonu 187,9 mm (İBB, 14 Ekim 2026)")
    u.set_defaults(func=cmd_upload_scenario)
    k = sub.add_parser("city", help="Whole-city 50 m simulation of the 14 Oct rain (and upload)")
    k.add_argument("--city", nargs="+", default=["istanbul-kent", "izmir-kent", "ankara-kent"])
    k.add_argument("--upload", action="store_true")
    k.add_argument("--backend", choices=["auto", "cpu", "gpu"], default="auto")
    k.add_argument("--start", default="2026-10-14T06:00")
    k.add_argument("--hours", type=int, default=30)
    k.add_argument("--station-mm", type=float, default=188.0)
    k.add_argument("--station-note", default="Sarıyer istasyonu 187,9 mm (İBB, 14 Ekim 2026)")
    k.set_defaults(func=cmd_city)
    co = sub.add_parser("corridors", help="City-wide stream corridors (no buildings), optional pilot cut-out")
    co.add_argument("--city", default="istanbul-kent")
    co.add_argument("--exclude", default="istanbul")
    co.add_argument("--upload", action="store_true")
    co.set_defaults(func=cmd_corridors)
    mz = sub.add_parser("merkez", help="City-centre rain ladder (20 m, buildings as walls) for /sehirler")
    mz.add_argument("--city", nargs="+", default=["istanbul-merkez", "izmir-merkez", "ankara-merkez"])
    mz.add_argument("--upload", action="store_true")
    mz.set_defaults(func=cmd_merkez)
    ct = sub.add_parser("corridor-tiles", help="Tile city-wide corridors for the web (viewport loading)")
    ct.add_argument("--city", nargs="+", default=["istanbul-kent", "izmir-kent", "ankara-kent"])
    ct.set_defaults(func=cmd_corridor_tiles)
    ld = sub.add_parser("ladder", help="Whole-city rain ladders (25-300 mm) for the what-if view")
    ld.add_argument("--city", nargs="+", default=["istanbul-kent", "izmir-kent", "ankara-kent"])
    ld.add_argument("--loss", type=float, required=True, help="calibrated loss (mm/h)")
    ld.add_argument("--sharpen", type=float, default=1.0)
    ld.add_argument("--shift", type=float, default=0.0)
    ld.add_argument("--upload", action="store_true")
    ld.set_defaults(func=cmd_ladder)
    cb = sub.add_parser("calibrate", help="Parameter sweep of the pilot model against the 14 Oct observations")
    cb.add_argument("--city", default="istanbul")
    cb.set_defaults(func=cmd_calibrate)
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
