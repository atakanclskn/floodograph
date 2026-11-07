// MapLibre GL 6 loads its worker from a URL relative to the bundle, which Turbopack
// does not emit. Copy the self-contained worker into public/ so setWorkerUrl can point at it.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json").replace(/package\.json$/, "dist/x"));
const out = join(import.meta.dirname, "..", "public", "vendor");
mkdirSync(out, { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
console.log("maplibre worker -> public/vendor/maplibre-gl-worker.mjs");
