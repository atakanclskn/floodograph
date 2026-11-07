import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Development-only bridge to the pipeline's local simulation output (pipeline/data/...), used by /sinema
 * while the frames are not in Supabase yet. Never serves anything in production builds.
 *   /sinema/yerel/meta            grid + frame list
 *   /sinema/yerel/kare/<tMin>     raw zstd frame (same bytes as the get_grid_frame RPC)
 *   /sinema/yerel/binalar         buildings GeoJSON in the get_buildings shape
 */
const SCENARIO = "istanbul-2026-10-14";
/** AOI bbox from pipeline/cities.yaml; used only until the simulation writes summary.json. */
const AOI = { w: 28.985, s: 41.08, e: 29.05, n: 41.13 };

function dataRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.FLOODOGRAPH_DATA_DIR ?? "../../pipeline/data");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ yol: string[] }> }) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const { yol } = await ctx.params;
  const scen = path.join(dataRoot(), "istanbul", "scenarios", SCENARIO);

  if (yol[0] === "meta") {
    const names = await readdir(path.join(scen, "frames")).catch(() => [] as string[]);
    const ts = names.filter((n) => /^\d+\.bin$/.test(n)).map((n) => Number(n.slice(0, -4))).sort((a, b) => a - b);
    const summary = await readJson<{ grid?: unknown; timeline?: { t_min: number; max_depth: number }[] }>(
      path.join(scen, "summary.json"),
    );
    const maxBy = new Map((summary?.timeline ?? []).map((r) => [r.t_min, r.max_depth]));
    let grid = summary?.grid ?? null;
    if (!grid && ts.length) {
      const raw = await readFile(path.join(scen, "frames", `${ts[0]}.bin`));
      const { decompress } = await import("fzstd");
      const view = new DataView(decompress(new Uint8Array(raw)).buffer);
      grid = {
        nx: view.getUint32(6, true),
        ny: view.getUint32(10, true),
        res_m: 20,
        epsg: 32635,
        corners_lonlat: [
          [AOI.w, AOI.n],
          [AOI.e, AOI.n],
          [AOI.e, AOI.s],
          [AOI.w, AOI.s],
        ],
        depthScale: 0.001,
        velocityScale: 0.001,
      };
    }
    return Response.json({
      id: SCENARIO,
      grid,
      frames: ts.map((t) => ({ tMin: t, path: `${t}.bin`, maxDepth: maxBy.get(t) ?? 0 })),
    });
  }

  if (yol[0] === "kare" && yol[1] && /^\d+$/.test(yol[1])) {
    try {
      const buf = await readFile(path.join(scen, "frames", `${yol[1]}.bin`));
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/octet-stream" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  if (yol[0] === "binalar") {
    type Raw = { properties: { osm_id: number; height_m: number; tier: string }; geometry: unknown };
    const fc = await readJson<{ features: Raw[] }>(path.join(dataRoot(), "istanbul", "buildings.geojson"));
    if (!fc) return new Response("Not found", { status: 404 });
    const impacts = new Map<number, { fw: number | null; md: number }>();
    try {
      const csv = (await readFile(path.join(scen, "impacts.csv"), "utf8")).trim().split(/\r?\n/).slice(1);
      for (const line of csv) {
        const [id, fw, md] = line.split(",");
        impacts.set(Number(id), { fw: fw ? Number(fw) : null, md: Number(md) || 0 });
      }
    } catch {
      /* simulation still running: no impacts yet */
    }
    return Response.json({
      type: "FeatureCollection",
      features: fc.features.map((f) => {
        const imp = impacts.get(f.properties.osm_id);
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: { id: f.properties.osm_id, h: f.properties.height_m, fw: imp?.fw ?? null, md: imp?.md ?? 0, tier: f.properties.tier },
        };
      }),
    });
  }

  return new Response("Not found", { status: 404 });
}
