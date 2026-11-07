import { createContext, useContext, useRef, type ComponentRef, type ReactNode, type RefObject } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurTargetView, BlurView } from "expo-blur";
import { color, radius } from "@/theme";

// Android blurs only what sits inside a BlurTargetView, so screens wrap their backdrop in one and
// every <Glass> picks the ref up from context. iOS and web blur whatever is behind natively.
type TargetRef = RefObject<ComponentRef<typeof View> | null>;
const BlurTargetContext = createContext<TargetRef | null>(null);

export function GlassScene({ backdrop, children }: { backdrop: ReactNode; children: ReactNode }) {
  const target = useRef<ComponentRef<typeof View>>(null);
  return (
    <View style={styles.scene}>
      <BlurTargetView ref={target} style={StyleSheet.absoluteFill} pointerEvents="none">
        {backdrop}
      </BlurTargetView>
      <BlurTargetContext.Provider value={target}>{children}</BlurTargetContext.Provider>
    </View>
  );
}

/** The web's .glass panel: blurred, slightly saturated surface with a hairline and a top highlight. */
export function Glass({
  style,
  children,
  intensity = 40,
  rounded = radius.lg,
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  intensity?: number;
  rounded?: number;
}) {
  const target = useContext(BlurTargetContext);
  return (
    <View style={[styles.shell, { borderRadius: rounded }, style]}>
      <BlurView
        tint="dark"
        intensity={intensity}
        blurTarget={Platform.OS === "android" && target ? target : undefined}
        blurMethod={target ? "dimezisBlurViewSdk31Plus" : "none"}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.tint]} />
      <View pointerEvents="none" style={[styles.highlight, { borderTopLeftRadius: rounded, borderTopRightRadius: rounded }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1, backgroundColor: color.ink },
  shell: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: color.line,
  },
  tint: { backgroundColor: color.glass },
  highlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
});
