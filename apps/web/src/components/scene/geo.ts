import { MercatorCoordinate } from "maplibre-gl";
import type { GridMeta } from "@floodograph/core";

export type LngLat = [number, number];

/**
 * Georeference of the simulation grid in a local metric frame.
 *
 * Scene units are "mercator metres": web-mercator distance divided by the metre scale at the grid centre,
 * so a local point maps to the MapLibre world by one affine transform (exactly what the map renders).
 * x grows east, y north, z up. The UTM grid is a near-affine quad in this frame (sub-metre over a few km),
 * so cell <-> local conversions use the corner quad directly.
 */
export class GridGeo {
  readonly nx: number;
  readonly ny: number;
  readonly resM: number;
  readonly origin: MercatorCoordinate;
  /** mercator units per scene unit (metre at the origin latitude) */
  readonly scale: number;
  readonly center: LngLat;
  /** local position of the NW corner and the grid's column / row edge vectors (whole grid) */
  private readonly p0: [number, number];
  private readonly ex: [number, number];
  private readonly ey: [number, number];
  private readonly inv: [number, number, number, number];
  /** unit vectors of the grid's east (column) and north (-row) axes in the local frame, for u/v rotation */
  readonly eastAxis: [number, number];
  readonly northAxis: [number, number];
  readonly corners: [LngLat, LngLat, LngLat, LngLat];

  constructor(grid: GridMeta) {
    this.nx = grid.nx;
    this.ny = grid.ny;
    this.resM = grid.res_m;
    this.corners = grid.corners_lonlat;
    const [nw, ne, se, sw] = grid.corners_lonlat;
    this.center = [(nw[0] + ne[0] + se[0] + sw[0]) / 4, (nw[1] + ne[1] + se[1] + sw[1]) / 4];
    this.origin = MercatorCoordinate.fromLngLat(this.center, 0);
    this.scale = this.origin.meterInMercatorCoordinateUnits();
    const NW = this.lngLatToLocal(nw);
    const NE = this.lngLatToLocal(ne);
    const SW = this.lngLatToLocal(sw);
    this.p0 = NW;
    this.ex = [NE[0] - NW[0], NE[1] - NW[1]];
    this.ey = [SW[0] - NW[0], SW[1] - NW[1]];
    const det = this.ex[0] * this.ey[1] - this.ex[1] * this.ey[0];
    this.inv = [this.ey[1] / det, -this.ey[0] / det, -this.ex[1] / det, this.ex[0] / det];
    const lx = Math.hypot(...this.ex);
    const ly = Math.hypot(...this.ey);
    this.eastAxis = [this.ex[0] / lx, this.ex[1] / lx];
    this.northAxis = [-this.ey[0] / ly, -this.ey[1] / ly];
  }

  lngLatToLocal(ll: LngLat): [number, number] {
    const m = MercatorCoordinate.fromLngLat(ll, 0);
    return [(m.x - this.origin.x) / this.scale, -(m.y - this.origin.y) / this.scale];
  }

  localToLngLat(x: number, y: number): LngLat {
    const m = new MercatorCoordinate(this.origin.x + x * this.scale, this.origin.y - y * this.scale, 0);
    const ll = m.toLngLat();
    return [ll.lng, ll.lat];
  }

  /** Grid fractional coordinates (s across columns 0..1 west->east, t across rows 0..1 north->south). */
  localToST(x: number, y: number): [number, number] {
    const dx = x - this.p0[0];
    const dy = y - this.p0[1];
    return [this.inv[0] * dx + this.inv[2] * dy, this.inv[1] * dx + this.inv[3] * dy];
  }

  stToLocal(s: number, t: number): [number, number] {
    return [this.p0[0] + s * this.ex[0] + t * this.ey[0], this.p0[1] + s * this.ex[1] + t * this.ey[1]];
  }

  /** Local centre of cell (col i, row j). */
  cellToLocal(i: number, j: number): [number, number] {
    return this.stToLocal((i + 0.5) / this.nx, (j + 0.5) / this.ny);
  }

  cellToLngLat(i: number, j: number): LngLat {
    const [x, y] = this.cellToLocal(i, j);
    return this.localToLngLat(x, y);
  }

  /** Fractional cell coordinates (cell centres at integers) of a local point. */
  localToCell(x: number, y: number): [number, number] {
    const [s, t] = this.localToST(x, y);
    return [s * this.nx - 0.5, t * this.ny - 0.5];
  }

  /** Grid velocity (u east, v north in the grid's own axes) rotated into the local frame. */
  velocityToLocal(u: number, v: number): [number, number] {
    return [u * this.eastAxis[0] + v * this.northAxis[0], u * this.eastAxis[1] + v * this.northAxis[1]];
  }

  bounds(padDeg = 0): [[number, number], [number, number]] {
    const lons = this.corners.map((c) => c[0]);
    const lats = this.corners.map((c) => c[1]);
    return [
      [Math.min(...lons) - padDeg, Math.min(...lats) - padDeg],
      [Math.max(...lons) + padDeg, Math.max(...lats) + padDeg],
    ];
  }

  /** Half extents of the grid in scene units, used for camera framing. */
  get sizeM(): [number, number] {
    return [Math.hypot(...this.ex), Math.hypot(...this.ey)];
  }
}

/** Bilinear sample of a row-major scalar field at fractional cell coords (clamped). */
export function sampleField(field: ArrayLike<number>, nx: number, ny: number, fx: number, fy: number): number {
  const x = Math.min(Math.max(fx, 0), nx - 1);
  const y = Math.min(Math.max(fy, 0), ny - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, nx - 1);
  const y1 = Math.min(y0 + 1, ny - 1);
  const ax = x - x0;
  const ay = y - y0;
  const a = field[y0 * nx + x0]! * (1 - ax) + field[y0 * nx + x1]! * ax;
  const b = field[y1 * nx + x0]! * (1 - ax) + field[y1 * nx + x1]! * ax;
  return a * (1 - ay) + b * ay;
}
