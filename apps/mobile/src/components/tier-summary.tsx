import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { TIER_LABEL, TIER_ORDER, type Tier } from "@floodograph/core";
import type { Overview } from "@/lib/data";
import type { OverviewState } from "@/lib/useOverview";
import { color, EASE_OUT, font, tierColor } from "@/theme";
import { Glass } from "./glass";
import { formatInt, useCountUp, useReducedMotion } from "./motion";
import { Button, Divider, Eyebrow, ReloadIcon } from "./ui";

function percent(n: number, total: number): string {
  if (!total) return "0";
  const p = (n / total) * 100;
  return (p < 10 ? p.toFixed(1) : p.toFixed(0)).replace(".", ",");
}

function Count({ value, style, delay = 0 }: { value: number; style: StyleProp<TextStyle>; delay?: number }) {
  const shown = useCountUp(value, 1100, delay);
  return <Text style={style}>{formatInt(shown)}</Text>;
}

function StackedBar({ counts, total }: { counts: Record<Tier, number>; total: number }) {
  const grow = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    grow.setValue(reduced ? 1 : 0);
    if (reduced) return;
    const anim = Animated.timing(grow, {
      toValue: 1,
      duration: 1100,
      delay: 200,
      easing: Easing.bezier(...EASE_OUT),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [grow, reduced, total]);
  // izle is the track itself (as on the web): the urgent tiers grow over it from the left.
  return (
    <View
      style={styles.bar}
      accessible
      accessibilityRole="image"
      accessibilityLabel={TIER_ORDER.map((t) => `${TIER_LABEL[t]} ${formatInt(counts[t])}`).join(", ")}
    >
      <Animated.View style={[styles.barFill, { transform: [{ scaleX: grow }] }]}>
        {TIER_ORDER.map((t) =>
          counts[t] > 0 ? (
            <View key={t} style={{ flex: counts[t], backgroundColor: tierColor[t] }} />
          ) : null,
        )}
      </Animated.View>
    </View>
  );
}

function SkeletonLine({ width, height = 14 }: { width: number | `${number}%`; height?: number }) {
  const t = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(t, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return <Animated.View style={{ width, height, borderRadius: 6, backgroundColor: color.lineStrong, opacity: t }} />;
}

function Ready({ data }: { data: Overview }) {
  const { counts, total, source } = data;
  return (
    <>
      <View style={styles.totalRow}>
        <Count value={total} style={styles.total} />
        <Text style={styles.totalLabel}>bina tek tek{"\n"}analiz edildi</Text>
      </View>
      <StackedBar counts={counts} total={total} />
      <View>
        {TIER_ORDER.map((t, i) => (
          <View key={t}>
            {i > 0 && <Divider />}
            <View style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: tierColor[t] }]} />
              <Text style={[styles.rowLabel, t === "acil" && { color: color.fg }]}>{TIER_LABEL[t]}</Text>
              <Text style={styles.rowPct}>%{percent(counts[t], total)}</Text>
              <Count value={counts[t]} delay={120 * i} style={[styles.rowCount, t === "acil" && { color: color.ember }]} />
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.source}>
        {source.kind === "scenario"
          ? `Kaynak: ${source.label} simülasyonu. Hastane, okul, itfaiye ve bakımevi bir kademe yukarı alınır.`
          : "Kaynak: HAND (en yakın akış çizgisine dikey mesafe) kademeleri. Hastane, okul, itfaiye ve bakımevi bir kademe yukarı alınır."}
      </Text>
    </>
  );
}

export function TierSummary({ state, onRetry }: { state: OverviewState; onRetry: () => void }) {
  return (
    <Glass style={styles.card}>
      <View style={styles.head}>
        <Eyebrow>Kademe özeti</Eyebrow>
        {state.status === "loading" && state.data && <Text style={styles.updating}>güncelleniyor…</Text>}
      </View>
      {state.data ? (
        <Ready data={state.data} />
      ) : state.status === "error" ? (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <Text style={styles.errorTitle}>Kademe sayıları yüklenemedi</Text>
          <Text style={styles.errorText}>{state.message}</Text>
          <Button
            label="Tekrar dene"
            variant="ghost"
            onPress={onRetry}
            icon={<ReloadIcon />}
            style={{ alignSelf: "flex-start", minHeight: 44 }}
          />
        </View>
      ) : (
        <View style={styles.skeleton} accessibilityLabel="Kademe sayıları yükleniyor">
          <SkeletonLine width="55%" height={44} />
          <SkeletonLine width="100%" height={12} />
          {TIER_ORDER.map((t) => (
            <SkeletonLine key={t} width="100%" height={18} />
          ))}
        </View>
      )}
      {state.status === "error" && state.data && (
        <Text style={[styles.source, { color: color.ember2 }]}>{state.message} Son alınan değerler gösteriliyor.</Text>
      )}
    </Glass>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, gap: 18 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  updating: { fontFamily: font.mono, fontSize: 12, color: color.fg3 },
  totalRow: { flexDirection: "row", alignItems: "flex-end", gap: 14 },
  total: {
    fontFamily: font.monoMedium,
    fontSize: 56,
    lineHeight: 58,
    letterSpacing: -2.4,
    color: color.fg,
    fontVariant: ["tabular-nums"],
  },
  totalLabel: { fontFamily: font.sans, fontSize: 14, lineHeight: 19, color: color.fg2, paddingBottom: 6 },
  bar: { height: 12, borderRadius: 6, overflow: "hidden", backgroundColor: tierColor.izle },
  barFill: { flex: 1, flexDirection: "row", gap: 2, transformOrigin: "left" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13 },
  swatch: { width: 9, height: 9, borderRadius: 2 },
  rowLabel: { flex: 1, fontFamily: font.sansMedium, fontSize: 15, color: color.fg2 },
  rowPct: { fontFamily: font.mono, fontSize: 13, color: color.fg3, fontVariant: ["tabular-nums"] },
  rowCount: {
    minWidth: 64,
    textAlign: "right",
    fontFamily: font.monoMedium,
    fontSize: 20,
    color: color.fg,
    fontVariant: ["tabular-nums"],
  },
  source: { fontFamily: font.sans, fontSize: 12.5, lineHeight: 18, color: color.fg3 },
  error: { gap: 10 },
  errorTitle: { fontFamily: font.sansSemi, fontSize: 16, color: color.fg },
  errorText: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.fg2 },
  skeleton: { gap: 14 },
});
