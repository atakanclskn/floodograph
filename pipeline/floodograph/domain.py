"""Domain types: pure data, no I/O."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from affine import Affine


@dataclass
class Grid:
    """A projected raster (metres). Row 0 is the northern edge."""

    data: np.ndarray
    transform: Affine
    epsg: int
    nodata: float = np.nan

    @property
    def shape(self) -> tuple[int, int]:
        return self.data.shape  # type: ignore[return-value]

    @property
    def cell(self) -> float:
        return abs(self.transform.a)

    def with_data(self, data: np.ndarray) -> "Grid":
        return Grid(data=data, transform=self.transform, epsg=self.epsg, nodata=self.nodata)


@dataclass
class HydroResult:
    dem: Grid  # conditioned DEM
    fdir: Grid  # D8 directions (ESRI dirmap)
    acc: Grid  # flow accumulation (cells)
    hand: Grid  # height above nearest drainage (m)
    streams_mask: np.ndarray  # boolean, cells treated as drainage
    meta: dict = field(default_factory=dict)
