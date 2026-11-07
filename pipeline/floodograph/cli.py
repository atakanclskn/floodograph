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

    city = load_cities()[args.city]
    rain = HistoricalRain(args.start, args.hours, station_total_mm=args.station_mm,
                          station_note=args.station_note).series(*city.rain_point)
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
    rain = HistoricalRain(args.start, args.hours, station_total_mm=args.station_mm,
                          station_note=args.station_note).series(*city.rain_point)
    imp = pd.read_csv(out / "impacts.csv")
    b = steps.buildings(city)[["osm_id", "hand_m", "critical"]]
    imp = imp.merge(b, on="osm_id", how="left")
    crit = imp["critical"].notna().to_numpy()
    static_idx = tier_index(imp["hand_m"].to_numpy(), crit)
    imp["tier"] = tier_names(scenario_tier_index(imp["max_depth_m"].to_numpy(), crit, static_idx))
    res = PostgisStore().replace_scenario(city, summary, rain.mm.tolist(), rain.step_min, imp, out / "frames",
                                          label=args.label)
    res["tiers"] = imp["tier"].value_counts().to_dict()
    print(json.dumps(res, ensure_ascii=False, indent=2))


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
    m.add_argument("--station-mm", type=float, default=150.0)
    m.add_argument("--station-note", default="Sarıyer ~150 kg/m², AKOM ara ölçümleri ve Prof. Dr. Orhan Şen")
    m.add_argument("--res", type=float, default=20.0)
    m.add_argument("--backend", choices=["auto", "cpu", "gpu"], default="auto",
                   help="solver: CUDA when available (auto), or force the numba CPU reference")
    m.set_defaults(func=cmd_simulate)
    u = sub.add_parser("upload-scenario", help="Upload a simulated scenario (impacts, rain, frames) to Supabase")
    u.add_argument("--city", default="istanbul")
    u.add_argument("--scenario", default="istanbul-2026-10-14")
    u.add_argument("--label", default="14 Ekim 2026 · gözlenen yağış (Sarıyer ~150 mm)")
    u.add_argument("--start", default="2026-10-14T06:00")
    u.add_argument("--hours", type=int, default=30)
    u.add_argument("--station-mm", type=float, default=150.0)
    u.add_argument("--station-note", default="Sarıyer ~150 kg/m², AKOM ara ölçümleri ve Prof. Dr. Orhan Şen")
    u.set_defaults(func=cmd_upload_scenario)
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
