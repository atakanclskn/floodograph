"""Split city-wide stream corridors into web-mercator tiles the map loads only where the screen is.

Each corridor is written once, into the tile that holds the centre of its extent (no clipping, so it is drawn
whole and counted once); the client fetches the tiles under the viewport plus a one-tile margin, which catches
corridors that start in a neighbouring tile. Output: apps/web/public/corridors/{z}/{x}/{y}.json + index.json.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import geopandas as gpd

Z = 12  # ~9.8 km x 7.4 km tiles at Istanbul's latitude


def tile_of(lon: float, lat: float, z: int = Z) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def write_tiles(sources: dict[str, Path], out_dir: Path, z: int = Z) -> dict:
    tiles: dict[tuple[int, int], list] = {}
    counts: dict[str, int] = {}
    for city, path in sources.items():
        g = gpd.read_file(path).to_crs(4326)
        counts[city] = len(g)
        for _, r in g.iterrows():
            minx, miny, maxx, maxy = r.geometry.bounds
            key = tile_of((minx + maxx) / 2, (miny + maxy) / 2, z)
            geom = json.loads(gpd.GeoSeries([r.geometry], crs=4326).simplify(0.00005).to_json())["features"][0]["geometry"]
            tiles.setdefault(key, []).append({
                "type": "Feature",
                "geometry": geom,
                "properties": {"id": f"{city}:{int(r['id'])}", "kind": r["kind"]},
            })
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob(f"{z}/*/*.json"):
        old.unlink()
    for (x, y), feats in tiles.items():
        p = out_dir / str(z) / str(x) / f"{y}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
    index = {"z": z, "tiles": sorted(f"{x}/{y}" for x, y in tiles), "cities": counts}
    (out_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    return {"tiles": len(tiles), "corridors": counts,
            "bytes": sum(p.stat().st_size for p in out_dir.rglob("*.json"))}
