import { FloodedPlaces } from "../places";
import { trackPitch } from "../rain-overlay";
import * as maplibregl from "maplibre-gl";
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from "maplibre-gl";
import * as THREE from "three";
import {
  applyFailures,
  createBuildings,
  FAIL_DV_DAMAGE,
  FAIL_DV_DESTROY,
  FAIL_V_MIN,
  wetCount,
  type BuildingIndex,
} from "./buildings";
import { buildTour, FLOOD_SPOTS, sampleTour, type TourPlan } from "./camera-path";
import { decodeDepth, FrameStore, openSource, type SceneSource } from "./data";
import { Debris } from "./debris";
import { FloodField } from "./field";
import { GridGeo } from "./geo";
import { FOG, hideOwnBuildings, sceneStyle } from "./scene-style";
import { Spray } from "./spray";
import { groundForGrid } from "./terrain";
import { foamTexture, gridTexture, rippleNormalTexture } from "./textures";
import { createWater, type SharedUniforms } from "./water";

/** Copied from maplibre-gl/dist by scripts/copy-maplibre-worker.mjs (pre-dev / pre-build). */
const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";
/** Simulation minutes per real second at ×1. */
export const BASE_RATE = 8;

export type Mode = "tur" | "serbest";
export type SeriesPoint = { t: number; d: number; ha: number };
export type EngineState = {
  phase: "hazirlaniyor" | "hazir" | "hata";
  step: string;
  error: string | null;
  source: SceneSource["kind"] | null;
  t: number;
  t0: number;
  t1: number;
  playing: boolean;
  rate: number;
  mode: Mode;
  tourReady: boolean;
  /** the cinematic tour has played to its end (the "what if in İzmir?" card appears) */
  tourDone: boolean;
  chapter: { title: string; sub: string; key: number } | null;
  loaded: number;
  total: number;
  series: SeriesPoint[];
  tourMarks: number[];
  stats: {
    wetBuildings: number;
    totalWet: number;
    maxDepth: number;
    wetHa: number;
    floating: number;
    destroyed: number;
    damaged: number;
    totalDestroyed: number;
  };
  fps: number;
};

const initialState: EngineState = {
  phase: "hazirlaniyor",
  step: "Harita hazırlanıyor",
  error: null,
  source: null,
  t: 0,
  t0: 0,
  t1: 1800,
  playing: false,
  rate: 1,
  mode: "tur",
  tourReady: false,
  tourDone: false,
  chapter: null,
  loaded: 0,
  total: 0,
  series: [],
  tourMarks: [],
  stats: { wetBuildings: 0, totalWet: 0, maxDepth: 0, wetHa: 0, floating: 0, destroyed: 0, damaged: 0, totalDestroyed: 0 },
  fps: 0,
};

/** What is modelled and what is only shown, in the map's (i) box. */
const TEMSIL_NOTU =
  "<b>Görsel temsil:</b> su, derinlik ve akış modelin 5 dakikalık karelerinden gelir. Yıkılma (hız × derinlik ≥ 7 m²/s), " +
  "hasar (≥ 3 m²/s; Clausen &amp; Clark 1990) ve araç sürüklenmesi (≥ 0,45 m²/s ya da 0,55 m) modelin eşikleridir; " +
  "yapı ve nesne fiziği simüle edilmez. Dalga, köpük ve pencere ışıkları atmosfer içindir.";

export class FloodEngine {
  state: EngineState = { ...initialState };
  private listeners = new Set<() => void>();
  private map: MlMap | null = null;
  private abort = new AbortController();
  private disposed = false;
  private raf = 0;

  private src: SceneSource | null = null;
  private geo: GridGeo | null = null;
  private store: FrameStore | null = null;
  private field: FloodField | null = null;
  private ground: Float32Array | null = null;
  private buildings: BuildingIndex | null = null;
  /** orange name labels on the schools, hospitals, ... the water reaches */
  private places: FloodedPlaces | null = null;
  private debris: Debris | null = null;
  private spray: Spray | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private local = new THREE.Matrix4();
  private mvp = new THREE.Matrix4();
  private inv = new THREE.Matrix4();
  private v4 = new THREE.Vector4();
  private shared: SharedUniforms;
  private night = { value: 0 };

  private narrow: boolean;
  private lowPower: boolean;
  private tour: TourPlan | null = null;
  private tourS = 0;
  private lastTick = 0;
  private lastEmit = 0;
  private visTime = 0;
  private lastT = 0;
  private frameIdx = -1;
  private fpsAcc = { n: 0, t: 0 };
  private series: SeriesPoint[] = [];
  /** sorted collapse / damage onset minutes, for the live counters */
  private failTimes = { destroyed: new Float64Array(0), damaged: new Float64Array(0) };
  private hazardsApplied = false;

  constructor(private readonly container: HTMLElement) {
    // the pane may still be 0 px wide when we start: fall back to the screen size
    const w = window.innerWidth || window.screen.width;
    this.narrow = w <= 640;
    this.lowPower = this.narrow || window.matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    const blank = gridTexture(1, 1, new Uint8Array([0, 128, 128, 0]));
    this.shared = {
      uTime: { value: 0 },
      uSimT: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uSun: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() },
      uFogColor: { value: new THREE.Color(FOG) },
      uFogRange: { value: new THREE.Vector2(4000, 20000) },
      uA: { value: blank },
      uB: { value: blank },
      uAlpha: { value: 0 },
      uMask: { value: blank },
      uEast: { value: new THREE.Vector2(1, 0) },
      uNorth: { value: new THREE.Vector2(0, 1) },
    };
  }

  /* ---------------------------------------------------------------- state plumbing for React */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /* ---------------------------------------------------------------- setup */

  async init() {
    try {
      maplibregl.setWorkerUrl(WORKER_URL);
      this.set({ step: "Senaryo okunuyor" });
      const src = await openSource();
      if (this.disposed) return;
      this.src = src;
      const geo = new GridGeo(src.grid);
      this.geo = geo;
      this.shared.uEast.value.set(...geo.eastAxis);
      this.shared.uNorth.value.set(...geo.northAxis);
      const ts = src.frames.map((f) => f.tMin);
      this.series = src.frames.map((f) => ({ t: f.tMin, d: f.maxDepth ?? 0, ha: 0 }));
      this.set({ source: src.kind, t0: ts[0]!, t1: ts[ts.length - 1]!, t: ts[0]!, total: ts.length, series: this.series });
      this.lastT = ts[0]!;

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const map = new maplibregl.Map({
        container: this.container,
        style: sceneStyle(),
        center: geo.center,
        zoom: this.narrow ? 12.2 : 12.9,
        pitch: 48,
        bearing: -32,
        maxBounds: geo.bounds(0.035),
        maxPitch: 80,
        attributionControl: false,
        fadeDuration: reduce ? 0 : 300,
        pixelRatio: Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.25 : 2),
        canvasContextAttributes: { antialias: !this.lowPower },
      });
      this.map = map;
      trackPitch(map);
      (window as unknown as { __sceneEngine?: FloodEngine }).__sceneEngine = this; // debugging handle
      map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: TEMSIL_NOTU }), "bottom-right");
      for (const ev of ["dragstart", "rotatestart", "pitchstart", "wheel", "touchstart"] as const)
        map.on(ev, (e: { originalEvent?: Event }) => {
          if (e.originalEvent && this.state.mode === "tur") this.freeMode();
        });

      // frames: start streaming now, the map and terrain load in parallel
      const store = new FrameStore(src, 8);
      this.store = store;
      store.onProgress = (loaded, total) => {
        if (loaded === total || loaded % 6 === 0) this.set({ loaded, series: [...this.series] });
        if (loaded === total) this.onAllFrames();
      };
      store.onFrame = (i) => {
        const s = store.stats(i)!;
        this.series[i] = { t: store.times[i]!, d: s.p99, ha: s.wetHa };
        if (Math.abs(i - this.frameIdx) <= 1) this.field?.invalidate();
      };
      store.start();

      this.set({ step: "Arazi yükseklikleri alınıyor" });
      const [ground] = await Promise.all([
        groundForGrid(geo, this.abort.signal),
        styleReady(map),
      ]);
      if (this.disposed) return;
      this.ground = ground;

      const stride = geo.nx * geo.ny > (this.lowPower ? 120_000 : 300_000) ? 2 : 1;
      this.field = new FloodField(store, geo.nx, geo.ny, stride);
      this.shared.uA.value = this.field.texA;
      this.shared.uB.value = this.field.texB;
      const tex = { normal: rippleNormalTexture(), foam: foamTexture() };
      // sub-cell tessellation: 3x3 vertices per 20 m cell on desktop (~7 m), so the waves have geometry to live on
      const sub = this.lowPower ? 1 : stride === 1 ? 3 : 4;
      this.scene.add(createWater(geo, ground, stride, this.shared, tex, sub));
      this.scene.add(new THREE.HemisphereLight(0x8fa3ad, 0x1a1410, 1.6));
      const sun = new THREE.DirectionalLight(0xffe7cc, 1.4);
      sun.position.copy(this.shared.uSun.value).multiplyScalar(1000);
      this.scene.add(sun);

      this.spray = new Spray(geo, ground, this.field, () => this.buildings?.mask ?? null, this.lowPower ? 1400 : 5000, this.shared);
      this.scene.add(this.spray.points);
      this.debris = new Debris(geo, ground, this.field, this.lowPower ? 140 : 520);
      this.scene.add(this.debris.group);

      map.addLayer(this.layer(), "place-label");
      this.set({ phase: "hazir", step: "Binalar yükleniyor" });
      this.loadBuildings();
      if (store.loaded === store.count) this.onAllFrames();
      this.lastTick = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    } catch (e) {
      if (this.disposed) return;
      this.set({ phase: "hata", error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async loadBuildings() {
    if (!this.src || !this.geo || !this.ground) return;
    try {
      const fc = await this.src.buildings();
      if (this.disposed) return;
      const b = createBuildings(fc, this.geo, this.ground, this.shared, this.night);
      this.buildings = b;
      if (this.map) hideOwnBuildings(this.map, fc.features.map((f) => f.properties.id));
      if (this.map) {
        this.places ??= new FloodedPlaces(this.map);
        this.places.setBuildings(fc.features as unknown as Parameters<FloodedPlaces["setBuildings"]>[0]);
      }
      this.shared.uMask.value = b.maskTex;
      this.debris?.setMask(b.mask);
      this.scene.add(b.mesh);
      this.set({ step: "", stats: { ...this.state.stats, totalWet: b.wetTimes.length } });
      if (this.state.loaded === this.state.total) this.placeDebris();
    } catch {
      this.set({ step: "" });
    }
  }

  private placeDebris() {
    if (!this.store || !this.debris || !this.buildings || !this.geo) return;
    this.debris.place(this.store.maxDepthField(), this.buildings.mask);
    // structural failures need every frame (onset = first frame over the threshold)
    if (this.store.loaded < this.store.count || this.hazardsApplied) return;
    this.hazardsApplied = true;
    const destroy = this.store.firstExceedance(FAIL_DV_DESTROY, FAIL_V_MIN);
    const damage = this.store.firstExceedance(FAIL_DV_DAMAGE, FAIL_V_MIN);
    const res = applyFailures(this.buildings, this.geo, destroy, damage);
    this.debris.addRubble(res.destroyed);
    const byFeature = (sev: number) => {
      const first = new Map<number, number>();
      const attr = this.buildings!.mesh.geometry.getAttribute("aFail");
      for (const part of this.buildings!.parts) {
        if (Math.abs(attr.getW(part.start) - sev) > 0.01) continue;
        const t = attr.getX(part.start);
        first.set(part.feature, Math.min(first.get(part.feature) ?? Infinity, t));
      }
      return Float64Array.from(first.values()).sort();
    };
    this.failTimes = { destroyed: byFeature(1), damaged: byFeature(0.3) };
    this.set({ stats: { ...this.state.stats, totalDestroyed: res.destroyedCount } });
  }

  /** All frames are in: time the tour to when the water reaches each reported flood spot, build it, scatter objects. */
  private onAllFrames() {
    const store = this.store;
    const geo = this.geo;
    if (!store || !geo || this.tour) return;
    // fallback timing for the event as a whole: first frame with water, frame with the widest flooded area
    let iPeak = 0;
    let first = -1;
    store.times.forEach((_, i) => {
      const s = store.stats(i);
      if (!s) return;
      if (s.wetHa > (store.stats(iPeak)?.wetHa ?? 0)) iPeak = i;
      if (first < 0 && s.wetHa > 2) first = i;
    });
    const tFirst = store.times[0]!;
    const tLast = store.times[store.count - 1]!;
    // street-level depth at each reported spot: 75th percentile of the open (non-building) cells within ~50 m,
    // the measure the calibration scored (the maximum would report the stream bed next door)
    const { nx, ny } = geo;
    const mask = this.buildings?.mask ?? null;
    const R = Math.max(1, Math.round(50 / geo.resM));
    const spots = FLOOD_SPOTS.flatMap((p) => {
      const [fx, fy] = geo.localToCell(...geo.lngLatToLocal(p.at));
      const ci = Math.round(fx);
      const cj = Math.round(fy);
      if (ci < R || cj < R || ci >= nx - R || cj >= ny - R) return [];
      const all: number[] = [];
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) all.push((cj + dj) * nx + ci + di);
      const open = mask ? all.filter((c) => mask[c]! < 0.5) : all;
      return [{ ...p, cells: open.length >= 5 ? open : all, arrive: Infinity, depth: 0 }];
    });
    // the town's peak: the frame where the spots are deepest together (every 3rd frame is plenty for a tour)
    const buf = new Uint8Array(nx * ny * 4);
    const vals: number[] = [];
    const step = store.count > 120 ? 3 : 1;
    let tPeak = store.times[iPeak]!;
    let bestSum = 0;
    for (let i = 0; i < store.count && spots.length; i += step) {
      if (!store.expand(i, buf)) continue;
      const t = store.times[i]!;
      let sum = 0;
      for (const s of spots) {
        vals.length = 0;
        for (const c of s.cells) vals.push(decodeDepth(buf[c * 4]!));
        vals.sort((a, b) => a - b);
        const d = vals[Math.floor(0.75 * (vals.length - 1))]!;
        if (d >= 0.3 && t < s.arrive) s.arrive = t;
        s.depth = Math.max(s.depth, d);
        sum += d;
      }
      if (sum > bestSum) {
        bestSum = sum;
        tPeak = t;
      }
    }
    // only spots the model actually floods (unless that leaves too few to make a tour)
    const wet = spots.filter((s) => s.depth >= 0.3);
    const fmt = (d: number) => d.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const stops = (wet.length >= 3 ? wet : spots).map((s) => ({
      at: s.at,
      title: s.title,
      sub: s.depth >= 0.3 ? `${s.report} · Modelde sokakta ${fmt(s.depth)} m su` : s.report,
      arrive: s.arrive,
    }));
    const firstArrive = Math.min(...stops.map((s) => s.arrive));
    const onset = Number.isFinite(firstArrive) ? firstArrive : first >= 0 ? store.times[first]! : tPeak - 240;
    const tStart = Math.min(Math.max(tFirst, onset - 45), tPeak);
    const tEnd = Math.min(tLast, tPeak + 90);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.tour = buildTour({ center: geo.center, stops, tStart, tPeak, tEnd, narrow: this.narrow, calm });
    this.set({ tourReady: true, tourMarks: [tStart, tPeak] });
    this.placeDebris();
    if (this.state.mode === "tur") this.startTour();
  }

  /* ---------------------------------------------------------------- controls */

  play() {
    if (this.state.t >= this.state.t1 && this.state.mode === "serbest") this.seek(this.state.t0);
    this.set({ playing: true });
  }
  pause() {
    this.set({ playing: false });
  }
  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }
  setRate(rate: number) {
    this.set({ rate });
  }
  seek(t: number) {
    const tt = Math.min(Math.max(t, this.state.t0), this.state.t1);
    if (this.state.mode === "tur") this.freeMode();
    if (tt < this.state.t - 6) this.debris?.reset();
    this.set({ t: tt });
  }
  startTour() {
    if (!this.tour) {
      this.set({ mode: "tur" });
      return;
    }
    this.tourS = 0;
    this.debris?.reset();
    this.set({ mode: "tur", playing: true, chapter: null });
  }
  freeMode() {
    this.set({ mode: "serbest", chapter: null });
  }

  /* ---------------------------------------------------------------- per-frame */

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;
    this.visTime += dt;
    const map = this.map;
    const st = this.state;
    if (!map || !this.field || !this.store) return;

    let t = st.t;
    if (st.mode === "tur" && this.tour) {
      if (st.playing) this.tourS += dt;
      const shot = sampleTour(this.tour, this.tourS);
      map.jumpTo({ center: shot.center, zoom: shot.zoom, pitch: shot.pitch, bearing: shot.bearing });
      t = shot.t;
      const ch = [...this.tour.chapters].reverse().find((c) => this.tourS >= c.at) ?? null;
      if (ch && ch.title !== st.chapter?.title) this.set({ chapter: { title: ch.title, sub: ch.sub, key: ch.at } });
      if (this.tourS >= this.tour.duration) this.set({ mode: "serbest", playing: false, chapter: null, tourDone: true });
    } else if (st.playing) {
      t = Math.min(t + dt * BASE_RATE * st.rate, st.t1);
      if (t >= st.t1) this.set({ playing: false });
    }

    this.field.update(t);
    const [i0] = this.store.locate(t);
    if (i0 !== this.frameIdx) {
      this.frameIdx = i0;
      this.store.setFocus(t);
    }
    this.shared.uAlpha.value = this.field.alpha;
    this.shared.uSimT.value = t;
    this.shared.uTime.value = this.visTime;
    this.night.value = smoothstep(700, 760, t) * (1 - smoothstep(1460, 1530, t));

    const moving = st.playing ? (st.mode === "tur" ? 1 : st.rate) : 0;
    if (t < this.lastT - 6) this.debris?.reset();
    this.debris?.update(dt * moving, this.visTime, t);
    this.spray?.update(dt, st.playing ? 1 : 0.35);
    this.lastT = t;
    this.places?.setTime(t);
    map.triggerRepaint();

    this.fpsAcc.n++;
    this.fpsAcc.t += dt;
    if (now - this.lastEmit > 100 || Math.abs(t - st.t) > 30) {
      this.lastEmit = now;
      const [a, b, k] = this.store.locate(t);
      const sa = this.store.stats(a);
      const sb = this.store.stats(b) ?? sa;
      const fps = this.fpsAcc.t > 0.5 ? Math.round(this.fpsAcc.n / this.fpsAcc.t) : st.fps;
      if (this.fpsAcc.t > 0.5) this.fpsAcc = { n: 0, t: 0 };
      this.set({
        t,
        fps,
        stats: {
          wetBuildings: this.buildings ? wetCount(this.buildings.wetTimes, t) : 0,
          totalWet: this.buildings?.wetTimes.length ?? 0,
          maxDepth: sa && sb ? sa.p99 * (1 - k) + sb.p99 * k : 0,
          wetHa: sa && sb ? sa.wetHa * (1 - k) + sb.wetHa * k : 0,
          floating: this.debris?.floating ?? 0,
          destroyed: wetCount(this.failTimes.destroyed, t),
          damaged: wetCount(this.failTimes.damaged, t),
          totalDestroyed: this.failTimes.destroyed.length,
        },
      });
    } else if (t !== st.t) {
      this.state = { ...this.state, t };
    }
  };

  private layer(): CustomLayerInterface {
    return {
      id: "flood-3d",
      type: "custom",
      renderingMode: "3d",
      onAdd: (map, gl) => {
        this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
        this.renderer.autoClear = false;
        const geo = this.geo!;
        const o = geo.origin;
        this.local.makeTranslation(o.x, o.y, 0).scale(new THREE.Vector3(geo.scale, -geo.scale, geo.scale));
      },
      render: (gl, opts: CustomRenderMethodInput) => this.draw(gl, opts),
      onRemove: () => {
        this.renderer?.dispose();
        this.renderer = null;
      },
    };
  }

  private draw(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    const r = this.renderer;
    if (!r || !this.geo) return;
    this.mvp.fromArray(opts.defaultProjectionData.mainMatrix as ArrayLike<number> as number[]).multiply(this.local);
    this.camera.projectionMatrix.copy(this.mvp);
    this.camera.projectionMatrixInverse.copy(this.mvp).invert();
    // camera centre = the point that projects to clip (0, 0, *, 0)
    this.inv.copy(this.camera.projectionMatrixInverse);
    this.v4.set(0, 0, 1, 0).applyMatrix4(this.inv);
    if (Math.abs(this.v4.w) > 1e-12) {
      const cam = this.shared.uCam.value.set(this.v4.x / this.v4.w, this.v4.y / this.v4.w, this.v4.z / this.v4.w);
      const c = this.map?.getCenter();
      if (c) {
        const [lx, ly] = this.geo.lngLatToLocal([c.lng, c.lat]);
        const d = Math.hypot(cam.x - lx, cam.y - ly, cam.z - (this.map?.getCenterElevation() ?? 0));
        this.shared.uFogRange.value.set(d * 1.6, d * 7);
      }
    }
    this.spray?.setViewportHeight(gl.drawingBufferHeight, opts.fov);
    r.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    r.resetState();
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.store?.dispose();
    this.debris?.dispose();
    this.spray?.dispose();
    this.field?.dispose();
    this.map?.remove();
    this.map = null;
    this.listeners.clear();
  }
}

function smoothstep(a: number, b: number, x: number) {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
}

/** Resolves once the style is parsed (custom layers can be added then), without waiting for every tile. */
function styleReady(map: MlMap): Promise<void> {
  return new Promise((resolve) => {
    const isReady = () => (map as unknown as { style?: { _loaded?: boolean } }).style?._loaded === true;
    if (isReady()) return resolve();
    const done = () => {
      clearInterval(poll);
      resolve();
    };
    map.once("style.load", done);
    map.once("load", done);
    const poll = setInterval(() => isReady() && done(), 100);
  });
}
