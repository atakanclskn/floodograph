import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from "maplibre-gl";
import * as THREE from "three";
import type { GridFrame, GridMeta } from "@floodograph/core";
import { D_MAX, V_MAX } from "@/components/scene/data";
import { GridGeo } from "@/components/scene/geo";
import { foamTexture, gridTexture, rippleNormalTexture } from "@/components/scene/textures";
import { createWater, type SharedUniforms } from "@/components/scene/water";

/** Depth (m) above which a cell counts as wet for the "near wet" mask the water mesh uses to skip dry triangles. */
const NEAR_WET_M = 0.02;

/**
 * The /sinema water surface on the /demo map: a three.js height field drawn as a MapLibre custom 3D layer,
 * fed from the demo's own frame store. The demo map is flat (hillshade, no 3D terrain), so the water sits on z = 0
 * like the extruded buildings. Waves, foam and reflections follow the modelled depth and velocity.
 */
export class Water3DLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private readonly geo: GridGeo;
  private readonly bufA: Uint8Array;
  private readonly bufB: Uint8Array;
  private readonly texA: THREE.DataTexture;
  private readonly texB: THREE.DataTexture;
  private readonly tmp: Uint8Array;
  private readonly shared: SharedUniforms;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly local = new THREE.Matrix4();
  private readonly mvp = new THREE.Matrix4();
  private readonly v4 = new THREE.Vector4();
  private renderer: THREE.WebGLRenderer | null = null;
  private map: MlMap | null = null;
  private keyA = -1;
  private keyB = -1;
  private readonly t0 = performance.now();
  /** keep repainting while visible so the water keeps moving */
  animate = true;

  constructor(grid: GridMeta, id = "water", lowPower = false, sub?: number) {
    this.id = id;
    const geo = new GridGeo(grid);
    this.geo = geo;
    const n = geo.nx * geo.ny;
    this.bufA = new Uint8Array(n * 4);
    this.bufB = new Uint8Array(n * 4);
    this.tmp = new Uint8Array(n);
    this.texA = gridTexture(geo.nx, geo.ny, this.bufA);
    this.texB = gridTexture(geo.nx, geo.ny, this.bufB);
    const blank = gridTexture(1, 1, new Uint8Array([0, 0, 0, 255]));
    this.shared = {
      uTime: { value: 0 },
      uSimT: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uSun: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() },
      uFogColor: { value: new THREE.Color(0x0b0f12) },
      uFogRange: { value: new THREE.Vector2(1e9, 2e9) },
      uA: { value: this.texA },
      uB: { value: this.texB },
      uAlpha: { value: 0 },
      uMask: { value: blank },
      uEast: { value: new THREE.Vector2(...geo.eastAxis) },
      uNorth: { value: new THREE.Vector2(...geo.northAxis) },
    };
    const ground = new Float32Array(n); // flat map
    const water = createWater(geo, ground, 1, this.shared, { normal: rippleNormalTexture(), foam: foamTexture() }, sub ?? (lowPower || n > 400_000 ? 1 : 3));
    this.scene.add(water);
    const o = geo.origin;
    this.local.makeTranslation(o.x, o.y, 0).scale(new THREE.Vector3(geo.scale, -geo.scale, geo.scale));
  }

  /** Show the blend of frames a and b. Re-encodes only when a keyframe changes; alpha is a uniform. */
  setFrames(a: GridFrame, b: GridFrame, alpha: number) {
    if (a.tMin !== this.keyA) {
      if (a.tMin === this.keyB) this.bufA.set(this.bufB);
      else this.encode(a, this.bufA);
      this.keyA = a.tMin;
      this.texA.needsUpdate = true;
    }
    if (b.tMin !== this.keyB) {
      this.encode(b, this.bufB);
      this.keyB = b.tMin;
      this.texB.needsUpdate = true;
    }
    this.shared.uAlpha.value = a === b ? 0 : alpha;
    this.map?.triggerRepaint();
  }

  /** Building footprint mask (1 inside), so water piles up against walls. Optional. */
  setMask(mask: Uint8Array) {
    const { nx, ny } = this.geo;
    const data = new Uint8Array(nx * ny * 4);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let s = 0;
        let k = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
            s += mask[jj * nx + ii]!;
            k++;
          }
        const c = (j * nx + i) * 4;
        data[c] = data[c + 1] = data[c + 2] = Math.round((s / k) * 255);
        data[c + 3] = 255;
      }
    this.shared.uMask.value = gridTexture(nx, ny, data);
  }

  private encode(f: GridFrame, out: Uint8Array) {
    const n = f.depth.length;
    const hasVel = f.u.length === n;
    const wet = this.tmp;
    for (let i = 0; i < n; i++) {
      const d = f.depth[i]!;
      const o = i * 4;
      out[o] = Math.round(Math.sqrt(Math.min(Math.max(d, 0), D_MAX) / D_MAX) * 255);
      out[o + 1] = hasVel ? Math.round(Math.min(Math.max(0.5 + f.u[i]! / (2 * V_MAX), 0), 1) * 255) : 128;
      out[o + 2] = hasVel ? Math.round(Math.min(Math.max(0.5 + f.v[i]! / (2 * V_MAX), 0), 1) * 255) : 128;
      wet[i] = d >= NEAR_WET_M ? 1 : 0;
    }
    // alpha = wet within one cell (lets the mesh drop fully dry triangles)
    const { nx, ny } = this.geo;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let v = 0;
        for (let dj = -1; dj <= 1 && !v; dj++)
          for (let di = -1; di <= 1 && !v; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) v = wet[jj * nx + ii]!;
          }
        out[(j * nx + i) * 4 + 3] = v ? 255 : 0;
      }
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    const r = this.renderer;
    if (!r) return;
    this.mvp.fromArray(opts.defaultProjectionData.mainMatrix as ArrayLike<number> as number[]).multiply(this.local);
    this.camera.projectionMatrix.copy(this.mvp);
    this.camera.projectionMatrixInverse.copy(this.mvp).invert();
    // camera position = the point that projects to clip (0, 0, *, 0)
    this.v4.set(0, 0, 1, 0).applyMatrix4(this.camera.projectionMatrixInverse);
    if (Math.abs(this.v4.w) > 1e-12) this.shared.uCam.value.set(this.v4.x / this.v4.w, this.v4.y / this.v4.w, this.v4.z / this.v4.w);
    this.shared.uTime.value = (performance.now() - this.t0) / 1000;
    r.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    r.resetState();
    r.render(this.scene, this.camera);
    if (this.animate && this.map?.getLayoutProperty(this.id, "visibility") !== "none") this.map?.triggerRepaint();
  }
}
