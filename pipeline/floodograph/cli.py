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


def main() -> None:
    p = argparse.ArgumentParser(prog="floodograph")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("static", help="DEM → HAND → corridors → buildings (optionally upload)")
    s.add_argument("--city", nargs="+", default=["istanbul"])
    s.add_argument("--upload", action="store_true")
    s.add_argument("--preview", action="store_true")
    s.set_defaults(func=cmd_static)
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
