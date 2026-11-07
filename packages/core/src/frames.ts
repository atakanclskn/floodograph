import { decompress } from "fzstd";
import type { GridFrame } from "./types";

/**
 * Binary frame format (little-endian), zstd-compressed:
 *   magic "FLDG" (4 bytes) | version u16 | nx u32 | ny u32 | tMin u32
 *   depthScale f32 | velocityScale f32
 *   depth u16[nx*ny] | u i16[nx*ny] | v i16[nx*ny]
 * Written by pipeline/floodograph/core/frames.py.
 */
const MAGIC = 0x47444c46; // "FLDG" read as LE u32
const HEADER_BYTES = 4 + 2 + 4 + 4 + 4 + 4 + 4;

export function decodeFrame(compressed: Uint8Array): GridFrame {
  const raw = decompress(compressed);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("Floodograph frame: bad magic");
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Floodograph frame: unsupported version ${version}`);
  const nx = view.getUint32(6, true);
  const ny = view.getUint32(10, true);
  const tMin = view.getUint32(14, true);
  const depthScale = view.getFloat32(18, true);
  const velocityScale = view.getFloat32(22, true);

  const n = nx * ny;
  if (raw.byteLength < HEADER_BYTES + n * 6) throw new Error("Floodograph frame: truncated");
  const bview = new DataView(raw.buffer, raw.byteOffset + HEADER_BYTES, n * 6);

  const depth = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    depth[i] = bview.getUint16(i * 2, true) * depthScale;
    u[i] = bview.getInt16(n * 2 + i * 2, true) * velocityScale;
    v[i] = bview.getInt16(n * 4 + i * 2, true) * velocityScale;
  }
  return { tMin, nx, ny, depth, u, v };
}

/** Linear blend between two frames for smooth playback (alpha in [0,1]). */
export function lerpFrames(a: GridFrame, b: GridFrame, alpha: number, out?: GridFrame): GridFrame {
  const n = a.depth.length;
  const o = out ?? {
    tMin: a.tMin,
    nx: a.nx,
    ny: a.ny,
    depth: new Float32Array(n),
    u: new Float32Array(n),
    v: new Float32Array(n),
  };
  const k = 1 - alpha;
  for (let i = 0; i < n; i++) {
    o.depth[i] = a.depth[i]! * k + b.depth[i]! * alpha;
    o.u[i] = a.u[i]! * k + b.u[i]! * alpha;
    o.v[i] = a.v[i]! * k + b.v[i]! * alpha;
  }
  o.tMin = a.tMin * k + b.tMin * alpha;
  return o;
}
