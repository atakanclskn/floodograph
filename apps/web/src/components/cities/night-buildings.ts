import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from "maplibre-gl";
import * as THREE from "three";

/**
 * The basemap's OSM buildings redrawn like the pilot's: windows in rows on the walls, a share of them lit warm,
 * flat dark roofs (a MapLibre fill-extrusion pattern would paint roofs too). Only the buildings of the tiles on
 * screen are built, and the mesh is rebuilt when the view settles. Flat map (z = 0), as on /sehirler.
 */
const vertex = /* glsl */ `
  attribute vec3 aInfo; // building seed, ground z, 1 = roof vertex
  varying vec3 vPos;
  varying float vSeed;
  varying float vAbove;
  void main() {
    vSeed = aInfo.x;
    vAbove = position.z - aInfo.y;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragment = /* glsl */ `
  varying vec3 vPos;
  varying float vSeed;
  varying float vAbove;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 N = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (N.z < 0.0) N = -N;
    vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
    float roof = step(0.7, N.z);
    vec3 base = mix(vec3(0.105, 0.125, 0.14), vec3(0.15, 0.17, 0.185), roof);
    float diff = 0.5 + 0.5 * max(dot(N, L), 0.0);
    vec3 col = base * diff;
    if (roof < 0.5) {
      // windows: 3.4 m bays along the wall, 3 m floors; about a third lit, warm, a few cooler (TV / LED)
      vec2 t = normalize(vec2(-N.y, N.x));
      float s = dot(vPos.xy, t);
      vec2 cell = vec2(floor(s / 3.4), floor(vAbove / 3.0));
      vec2 f = vec2(fract(s / 3.4), fract(vAbove / 3.0));
      float inWin = step(0.28, f.x) * step(f.x, 0.74) * step(0.34, f.y) * step(f.y, 0.8) * step(1.0, vAbove);
      float h = hash(cell + vec2(vSeed * 13.1, vSeed * 7.7));
      float on = step(0.66, h);
      vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.86, 0.62), hash(cell * 1.7 + vSeed));
      vec3 lamp = mix(warm, vec3(0.62, 0.78, 1.0), step(0.95, h));
      col = mix(col, vec3(0.06, 0.075, 0.085), inWin * (1.0 - on) * 0.8);
      col += lamp * inWin * on * (0.55 + 0.25 * hash(cell + 3.1));
      // a faint warm spill near the ground floor
      col += vec3(0.25, 0.16, 0.08) * (1.0 - smoothstep(0.0, 4.0, vAbove)) * 0.15;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

type Ring = [number, number][];

/** From this zoom the layer draws the buildings (the basemap's plain extrusions fade out, see sceneStyle). */
export const NIGHT_MIN_ZOOM = 14;

export class NightBuildingsLayer implements CustomLayerInterface {
  readonly id = "night-buildings";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map: MlMap | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly local = new THREE.Matrix4();
  private readonly mvp = new THREE.Matrix4();
  private mesh: THREE.Mesh | null = null;
  private readonly material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastKey = "";

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
    map.on("moveend", this.schedule);
    map.on("sourcedata", this.onSource);
    this.schedule();
  }

  onRemove() {
    this.map?.off("moveend", this.schedule);
    this.map?.off("sourcedata", this.onSource);
    clearTimeout(this.timer);
    this.mesh?.geometry.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  private onSource = (e: { sourceId?: string; isSourceLoaded?: boolean; tile?: unknown }) => {
    if (e.sourceId === "omt" && e.tile) this.schedule();
  };

  private schedule = () => {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rebuild(), 250);
  };

  /** Build one merged mesh from the building features of the tiles currently loaded for the view. */
  private rebuild() {
    const map = this.map;
    if (!map || map.getZoom() < NIGHT_MIN_ZOOM - 0.3) {
      if (this.mesh) this.mesh.visible = false;
      map?.triggerRepaint();
      return;
    }
    // tiles still arriving: try again shortly (the water layer repaints continuously, so "idle" may never fire)
    if (!map.isSourceLoaded("omt")) {
      this.schedule();
      if (this.mesh?.geometry.attributes.position?.count) return;
    }
    const feats = map.querySourceFeatures("omt", { sourceLayer: "building" });
    const c = map.getCenter();
    const key = `${feats.length}|${c.lng.toFixed(3)}|${c.lat.toFixed(3)}`;
    if (key === this.lastKey && this.mesh) {
      this.mesh.visible = true;
      return;
    }
    this.lastKey = key;
    const origin = MercatorCoordinate.fromLngLat([c.lng, c.lat], 0);
    const scale = origin.meterInMercatorCoordinateUnits();
    const toLocal = (lng: number, lat: number): [number, number] => {
      const m = MercatorCoordinate.fromLngLat([lng, lat], 0);
      return [(m.x - origin.x) / scale, -(m.y - origin.y) / scale];
    };
    const pos: number[] = [];
    const info: number[] = [];
    const idx: number[] = [];
    const seen = new Set<string>();
    for (const f of feats) {
      const g = f.geometry;
      if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue;
      const h = Number(f.properties?.render_height ?? 9) || 9;
      const minH = Number(f.properties?.render_min_height ?? 0) || 0;
      if (h <= minH) continue;
      const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
      const seed = ((Number(f.id ?? 0) % 997) + 997) % 997 / 997;
      for (const poly of polys) {
        const outer = poly[0];
        if (!outer || outer.length < 4) continue;
        // the same building piece arrives once per overlapping tile: draw it once
        const k = `${outer[0]![0]!.toFixed(6)},${outer[0]![1]!.toFixed(6)},${outer.length},${h}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const ring: Ring = outer.slice(0, -1).map(([lng, lat]) => toLocal(lng!, lat!));
        const start = pos.length / 3;
        for (const [x, y] of ring) {
          pos.push(x, y, minH, x, y, h);
          info.push(seed, minH, 0, seed, minH, 1);
        }
        const n = ring.length;
        for (let i = 0; i < n; i++) {
          const a = start + i * 2;
          const b = start + ((i + 1) % n) * 2;
          idx.push(a, b, b + 1, a, b + 1, a + 1);
        }
        const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []);
        for (const [p, q, r] of tris) idx.push(start + p! * 2 + 1, start + q! * 2 + 1, start + r! * 2 + 1);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute("aInfo", new THREE.Float32BufferAttribute(info, 3));
    geom.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geom;
      this.mesh.visible = true;
    } else {
      this.mesh = new THREE.Mesh(geom, this.material);
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    }
    this.local.makeTranslation(origin.x, origin.y, 0).scale(new THREE.Vector3(scale, -scale, scale));
    map.triggerRepaint();
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    const r = this.renderer;
    if (!r || !this.mesh?.visible) return;
    this.mvp.fromArray(opts.defaultProjectionData.mainMatrix as ArrayLike<number> as number[]).multiply(this.local);
    this.camera.projectionMatrix.copy(this.mvp);
    r.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    r.resetState();
    r.render(this.scene, this.camera);
  }
}
