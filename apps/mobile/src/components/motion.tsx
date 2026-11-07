import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { EASE_OUT } from "@/theme";

// Built-in Animated only (no Reanimated/worklets), so everything runs in Expo Go as-is.

const easeOut = Easing.bezier(...EASE_OUT);

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** Fade + rise on mount, the mobile twin of the web's .hero-rise. */
export function Rise({
  delay = 0,
  distance = 14,
  style,
  children,
}: {
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: reduced ? 0 : 600,
      delay: reduced ? 0 : delay,
      easing: easeOut,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay, reduced]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: t,
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Turkish digit grouping (19.763) without relying on Intl data in the JS engine. */
export function formatInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Animated integer that counts up whenever `value` changes. */
export function useCountUp(value: number, duration = 1100, delay = 0): number {
  const [shown, setShown] = useState(0);
  const reduced = useReducedMotion();
  const from = useRef(0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      from.current = value;
      return;
    }
    const v = new Animated.Value(from.current);
    const id = v.addListener(({ value: x }) => setShown(x));
    const anim = Animated.timing(v, { toValue: value, duration, delay, easing: easeOut, useNativeDriver: false });
    anim.start(() => {
      from.current = value;
    });
    return () => {
      anim.stop();
      v.removeListener(id);
    };
  }, [value, duration, delay, reduced]);
  return shown;
}

/** Pressable that dips to 0.97 while held, like .btn-ember:active on the web. */
export function PressableScale({
  style,
  children,
  ...rest
}: Omit<PressableProps, "style" | "children"> & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <Pressable {...rest} onPressIn={() => to(0.97)} onPressOut={() => to(1)}>
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Soft breathing dot for "live data" markers. */
export function PulseDot({ color, size = 8 }: { color: string; size?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, reduced]);
  return (
    <Animated.View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: color,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
        }}
      />
      <Animated.View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </Animated.View>
  );
}
