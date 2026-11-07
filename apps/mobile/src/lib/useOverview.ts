import { useCallback, useEffect, useRef, useState } from "react";
import { loadOverview, type Overview } from "./data";

export type OverviewState =
  | { status: "loading"; data: Overview | null }
  | { status: "ready"; data: Overview }
  | { status: "error"; data: Overview | null; message: string };

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : "";
  if (/network|fetch|timed? ?out|abort/i.test(msg)) return "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.";
  return msg ? `Veri alınamadı: ${msg}` : "Veri alınamadı.";
}

export function useOverview() {
  const [state, setState] = useState<OverviewState>({ status: "loading", data: null });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ status: "loading", data: s.data }));
    try {
      const data = await loadOverview();
      if (id === seq.current) setState({ status: "ready", data });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ status: "error", data: s.data, message: describe(e) }));
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  return { state, reload: load };
}
