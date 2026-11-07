"""Quick PNG preview for humans: hillshade + HAND + corridors by kind + buildings by tier."""
from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LightSource

from .config import CityConfig
from .domain import HydroResult

TIER_COLORS = {"acil": "#d7301f", "yuksek": "#fc8d59", "orta": "#fdcc8a", "izle": "#d9d9d9"}
KIND_STYLE = {
    "buried_osm": dict(color="#6a3d9a", lw=2.4, ls="--", label="Gömülü dere (OSM)"),
    "derived": dict(color="#1f78b4", lw=1.8, ls=":", label="Haritada olmayan akış koridoru"),
    "open": dict(color="#33a02c", lw=1.6, ls="-", label="Açık dere"),
}


def render(city: CityConfig, h: HydroResult, buildings: gpd.GeoDataFrame, corridors: gpd.GeoDataFrame,
           out: Path) -> Path:
    tf = h.dem.transform
    ny, nx = h.dem.shape
    extent = (tf.c, tf.c + tf.a * nx, tf.f + tf.e * ny, tf.f)
    fig, ax = plt.subplots(figsize=(11, 11), dpi=150)
    hs = LightSource(azdeg=315, altdeg=45).hillshade(np.nan_to_num(h.dem.data), vert_exag=2, dx=h.dem.cell, dy=h.dem.cell)
    ax.imshow(hs, cmap="gray", extent=extent, alpha=0.9)
    hand = np.ma.masked_where(~(h.hand.data <= 5), h.hand.data)
    im = ax.imshow(hand, cmap="Blues_r", vmin=0, vmax=5, extent=extent, alpha=0.55)
    b = buildings.to_crs(city.epsg)
    for tier, color in TIER_COLORS.items():
        sel = b[b.tier == tier]
        if len(sel):
            sel.plot(ax=ax, color=color, linewidth=0, label=f"Bina: {tier} ({len(sel)})")
    c = corridors.to_crs(city.epsg)
    for kind, st in KIND_STYLE.items():
        sel = c[c.kind == kind]
        if len(sel):
            sel.plot(ax=ax, color=st["color"], linewidth=st["lw"], linestyle=st["ls"], label=st["label"])
    aoi = gpd.GeoSeries.from_xy([0], [0])  # placeholder to keep legend order stable
    del aoi
    w, s, e, n = gpd.GeoSeries.from_wkt([f"POLYGON(({city.bbox[0]} {city.bbox[1]},{city.bbox[2]} {city.bbox[1]},{city.bbox[2]} {city.bbox[3]},{city.bbox[0]} {city.bbox[3]},{city.bbox[0]} {city.bbox[1]}))"], crs=4326).to_crs(city.epsg).total_bounds
    ax.set_xlim(w, e)
    ax.set_ylim(s, n)
    ax.set_axis_off()
    ax.legend(loc="lower left", fontsize=8, framealpha=0.9)
    fig.colorbar(im, ax=ax, fraction=0.03, pad=0.01, label="HAND (m), ≤ 5 m")
    ax.set_title(f"Floodograph · {city.name} · HAND, akış koridorları, bina kademeleri", fontsize=11)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out
