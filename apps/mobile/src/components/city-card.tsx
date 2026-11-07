import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { City } from "@floodograph/core";
import { color, font } from "@/theme";
import { Glass } from "./glass";
import { formatInt, PressableScale, PulseDot } from "./motion";
import { Arrow, Eyebrow } from "./ui";

const FALLBACK_NAME = "İstanbul · Sarıyer-Ayazağa";

function extentKm(bbox: City["bbox"]): [number, number] {
  const [w, s, e, n] = bbox;
  const lat = ((s + n) / 2) * (Math.PI / 180);
  return [(e - w) * 111.32 * Math.cos(lat), (n - s) * 110.57];
}

const dec = (x: number, d = 1) => x.toFixed(d).replace(".", ",");

/** Tiny schematic of the pilot area: contour lines, a buried-stream dash and a pin. */
function AreaGlyph() {
  return (
    <Svg width={64} height={64} viewBox="0 0 64 64">
      <Rect x={0.5} y={0.5} width={63} height={63} rx={14} fill={color.ink2} stroke={color.line} />
      {[0, 1, 2, 3].map((i) => (
        <Path
          key={i}
          d={`M-2 ${46 - i * 9} C 14 ${38 - i * 9}, 24 ${54 - i * 10}, 36 ${44 - i * 9} S 56 ${34 - i * 8}, 66 ${40 - i * 9}`}
          stroke="rgba(111, 168, 201, 0.35)"
          strokeWidth={1}
          fill="none"
        />
      ))}
      <Path d="M10 62 C 20 48, 28 44, 34 34 S 46 18, 56 10" stroke={color.ember} strokeWidth={1.6} strokeDasharray="1.5 4" strokeLinecap="round" fill="none" />
      <Circle cx={34} cy={34} r={4.5} fill={color.ember} />
      <Circle cx={34} cy={34} r={8.5} stroke={color.ember} strokeOpacity={0.35} fill="none" />
    </Svg>
  );
}

export function CityCard({
  city,
  buildings,
  onOpenMap,
}: {
  city: City | null;
  buildings: number | null;
  onOpenMap: () => void;
}) {
  const name = city?.name ?? FALLBACK_NAME;
  const [cityName, district] = name.split("·").map((x) => x.trim());
  const [wKm, hKm] = city ? extentKm(city.bbox) : [null, null];
  return (
    <PressableScale
      onPress={onOpenMap}
      accessibilityRole="button"
      accessibilityLabel={`${name} pilot bölgesi. Haritada aç.`}
    >
      <Glass style={styles.card}>
        <View style={styles.top}>
          <AreaGlyph />
          <View style={styles.titles}>
            <View style={styles.live}>
              <PulseDot color={color.water} size={7} />
              <Eyebrow>Pilot bölge</Eyebrow>
            </View>
            <Text style={styles.city} numberOfLines={1}>
              {cityName}
            </Text>
            {district ? (
              <Text style={styles.district} numberOfLines={1}>
                {district}
              </Text>
            ) : null}
          </View>
          <View style={styles.go}>
            <Arrow stroke={color.fg} size={16} />
          </View>
        </View>
        <View style={styles.facts}>
          <Fact k="Alan" v={wKm != null && hKm != null ? `${dec(wKm * hKm, 0)} km²` : "…"} />
          <Fact k="Izgara" v={city ? `${dec(city.resM, 0)} m` : "…"} />
          <Fact k="Bina" v={buildings != null ? formatInt(buildings) : "…"} />
        </View>
      </Glass>
    </PressableScale>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factK}>{k}</Text>
      <Text style={styles.factV} numberOfLines={1} adjustsFontSizeToFit>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 16 },
  top: { flexDirection: "row", alignItems: "center", gap: 14 },
  titles: { flex: 1, gap: 3 },
  live: { flexDirection: "row", alignItems: "center", gap: 8 },
  city: { fontFamily: font.display, fontSize: 26, letterSpacing: -0.6, color: color.fg },
  district: { fontFamily: font.sansMedium, fontSize: 15, color: color.water },
  go: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  facts: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: color.line,
    paddingTop: 14,
    gap: 12,
  },
  fact: { flex: 1, gap: 4 },
  factK: { fontFamily: font.mono, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: color.fg3 },
  factV: { fontFamily: font.monoMedium, fontSize: 14, color: color.fg },
});
