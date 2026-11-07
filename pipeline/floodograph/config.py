"""City registry and runtime settings (config-driven: adding a city is a YAML edit, not code)."""
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("FLOODOGRAPH_DATA", ROOT / "data"))
load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class CityConfig:
    id: str
    name: str
    epsg: int
    bbox: tuple[float, float, float, float]  # west, south, east, north (WGS84)
    rain_point: tuple[float, float]  # lat, lon
    hydro_buffer_km: float
    res_m: float

    @property
    def hydro_bbox(self) -> tuple[float, float, float, float]:
        """AOI grown by hydro_buffer_km so upstream catchments are included."""
        w, s, e, n = self.bbox
        lat = (s + n) / 2
        dlat = self.hydro_buffer_km / 111.32
        dlon = self.hydro_buffer_km / (111.32 * math.cos(math.radians(lat)))
        return (w - dlon, s - dlat, e + dlon, n + dlat)

    @property
    def data_dir(self) -> Path:
        d = DATA_DIR / self.id
        d.mkdir(parents=True, exist_ok=True)
        return d


def load_cities(path: Path = ROOT / "cities.yaml") -> dict[str, CityConfig]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return {
        cid: CityConfig(
            id=cid,
            name=c["name"],
            epsg=int(c["epsg"]),
            bbox=tuple(c["bbox"]),
            rain_point=tuple(c["rain_point"]),
            hydro_buffer_km=float(c.get("hydro_buffer_km", 4)),
            res_m=float(c.get("res_m", 10)),
        )
        for cid, c in raw.items()
    }


def db_url() -> str | None:
    return os.environ.get("SUPABASE_DB_URL")
