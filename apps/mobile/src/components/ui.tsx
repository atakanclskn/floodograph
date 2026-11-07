import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { color, font, radius } from "@/theme";
import { PressableScale } from "./motion";

export function Eyebrow({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ember" }) {
  return <Text style={[styles.eyebrow, tone === "ember" && { color: color.ember2 }]}>{children}</Text>;
}

export function Arrow({ back = false, size = 18, stroke = color.ink }: { back?: boolean; size?: number; stroke?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d={back ? "M13 8H3M7 4L3 8l4 4" : "M3 8h10M9 4l4 4-4 4"}
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ReloadIcon({ size = 18, stroke = color.fg }: { size?: number; stroke?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "ember" | "ghost";
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = "ember", icon, style, labelStyle, accessibilityHint }: ButtonProps) {
  const ember = variant === "ember";
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hitSlop={6}
      style={[styles.button, ember ? styles.buttonEmber : styles.buttonGhost, style]}
    >
      <Text style={[styles.buttonLabel, { color: ember ? color.ink : color.fg }, labelStyle]}>{label}</Text>
      {icon}
    </PressableScale>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth * 2, backgroundColor: color.line }, style]} />;
}

const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: font.mono,
    fontSize: 12,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: color.fg3,
  },
  button: {
    minHeight: 52,
    paddingHorizontal: 22,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonEmber: { backgroundColor: color.ember },
  buttonGhost: { borderWidth: 1, borderColor: color.lineStrong },
  buttonLabel: { fontFamily: font.sansSemi, fontSize: 16 },
});
