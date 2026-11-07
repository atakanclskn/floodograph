import { StyleSheet, View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { color } from "@/theme";

/**
 * Hero backdrop from the web landing, re-drawn for a phone: faint water-blue contour lines,
 * the dashed ember flow path that crosses them, and two soft glows (ember top, water bottom).
 */
export function Backdrop() {
  const contours = Array.from({ length: 9 }, (_, i) => {
    const d = i * 34;
    return `M-20 ${560 - d} C ${70 + i * 6} ${500 - d}, ${150 + i * 4} ${610 - d * 1.15}, 220 ${540 - d} S ${330 - i * 3} ${430 - d * 0.9}, 420 ${500 - d * 1.05}`;
  });
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: color.ink }]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="ember" cx="78%" cy="8%" rx="70%" ry="38%">
            <Stop offset="0" stopColor={color.ember} stopOpacity="0.30" />
            <Stop offset="1" stopColor={color.ember} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="water" cx="10%" cy="92%" rx="80%" ry="40%">
            <Stop offset="0" stopColor={color.water} stopOpacity="0.20" />
            <Stop offset="1" stopColor={color.water} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="390" height="844" fill="url(#ember)" />
        <Rect x="0" y="0" width="390" height="844" fill="url(#water)" />
        {contours.map((d, i) => (
          <Path key={i} d={d} stroke="rgba(111, 168, 201, 0.20)" strokeWidth={1} fill="none" />
        ))}
        <Path
          d="M60 860 C 90 760, 150 700, 180 640 S 250 520, 300 470 S 380 380, 420 300"
          stroke={color.ember}
          strokeWidth={1.6}
          strokeDasharray="2 7"
          strokeLinecap="round"
          opacity={0.75}
          fill="none"
        />
      </Svg>
    </View>
  );
}
