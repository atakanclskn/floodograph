import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, BackHandler, Easing, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { Glass, GlassScene } from "@/components/glass";
import { MapFrame, type MapFrameHandle } from "@/components/map-frame";
import { PulseDot, useReducedMotion } from "@/components/motion";
import { Arrow, Button, Eyebrow, ReloadIcon } from "@/components/ui";
import { color, DEMO_URL, font } from "@/theme";

const ICON = require("../assets/images/icon.png");

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: color.line }]}
    >
      {children}
    </Pressable>
  );
}

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const frame = useRef<MapFrameHandle>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [canGoBack, setCanGoBack] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const veil = useRef(new Animated.Value(1)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  // Android back: step back inside the map's own history first, then leave the screen.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (canGoBack && phase.kind !== "error") {
          frame.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [canGoBack, phase.kind]),
  );

  // Fade the loading veil out once the page is up, back in when reloading.
  useEffect(() => {
    Animated.timing(veil, {
      toValue: phase.kind === "ready" ? 0 : 1,
      duration: reduced ? 0 : 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [phase.kind, veil, reduced]);

  useEffect(() => {
    if (phase.kind !== "loading" || reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase.kind, breathe, reduced]);

  const onLoadStart = useCallback(() => {
    progress.setValue(0);
    setPhase((p) => (p.kind === "error" ? p : { kind: "loading" }));
  }, [progress]);

  const onProgress = useCallback(
    (p: number) => {
      Animated.timing(progress, { toValue: p, duration: 200, useNativeDriver: false }).start();
    },
    [progress],
  );

  const onLoaded = useCallback(() => {
    progress.setValue(1);
    setPhase((p) => (p.kind === "error" ? p : { kind: "ready" }));
  }, [progress]);

  const onFailed = useCallback((message: string) => setPhase({ kind: "error", message }), []);

  const retry = useCallback(() => {
    setPhase({ kind: "loading" });
    frame.current?.reload();
  }, []);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <IconButton label="Geri" onPress={leave}>
          <Arrow back stroke={color.fg} size={20} />
        </IconButton>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            Sel analiz haritası
          </Text>
          <View style={styles.subRow}>
            <PulseDot color={phase.kind === "error" ? color.ember : color.water} size={6} />
            <Text style={styles.sub} numberOfLines={1}>
              {phase.kind === "error" ? "Bağlantı hatası" : phase.kind === "loading" ? "Yükleniyor" : "Sarıyer–Ayazağa · canlı"}
            </Text>
          </View>
        </View>
        <IconButton label="Yeniden yükle" onPress={retry}>
          <ReloadIcon size={19} />
        </IconButton>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.progress,
            {
              opacity: phase.kind === "loading" ? 1 : 0,
              width: progress.interpolate({ inputRange: [0, 1], outputRange: ["4%", "100%"] }),
            },
          ]}
        />
      </View>

      <View style={styles.body}>
        <MapFrame
          ref={frame}
          url={DEMO_URL}
          onLoadStart={onLoadStart}
          onProgress={onProgress}
          onLoaded={onLoaded}
          onFailed={onFailed}
          onCanGoBack={setCanGoBack}
          onExitToHome={leave}
        />

        <Animated.View
          pointerEvents={phase.kind === "ready" ? "none" : "auto"}
          style={[StyleSheet.absoluteFill, { opacity: veil }]}
        >
          <GlassScene backdrop={<Backdrop />}>
            <View style={[styles.center, { paddingBottom: insets.bottom + 40 }]}>
              {phase.kind === "error" ? (
                <Glass style={styles.errorCard}>
                  <Eyebrow tone="ember">Harita açılamadı</Eyebrow>
                  <Text style={styles.errorTitle}>Sayfaya şu an ulaşılamıyor.</Text>
                  <Text style={styles.errorText}>{phase.message}</Text>
                  <View style={styles.errorActions}>
                    <Button label="Tekrar dene" onPress={retry} icon={<ReloadIcon stroke={color.ink} />} style={{ flex: 1 }} />
                    <Button label="Tarayıcıda aç" variant="ghost" onPress={() => void Linking.openURL(DEMO_URL)} />
                  </View>
                </Glass>
              ) : (
                <View style={styles.loading} accessibilityLiveRegion="polite" accessibilityLabel="Harita yükleniyor">
                  <Animated.Image
                    source={ICON}
                    resizeMode="contain"
                    style={[
                      styles.loadingIcon,
                      {
                        opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
                        transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
                      },
                    ]}
                  />
                  <Text style={styles.loadingTitle}>Harita hazırlanıyor</Text>
                  <Text style={styles.loadingText}>Arazi, akış koridorları ve 19 binden fazla bina yükleniyor.</Text>
                </View>
              )}
            </View>
          </GlassScene>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: color.ink2,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: color.line,
    zIndex: 2,
  },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  titles: { flex: 1, gap: 2, paddingHorizontal: 4 },
  title: { fontFamily: font.displaySemi, fontSize: 18, letterSpacing: -0.3, color: color.fg },
  subRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sub: { fontFamily: font.mono, fontSize: 11.5, color: color.fg3 },
  progress: { position: "absolute", left: 0, bottom: -1, height: 2, backgroundColor: color.ember },
  body: { flex: 1 },
  center: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  loading: { alignItems: "center", gap: 10 },
  loadingIcon: { width: 112, height: 112, marginBottom: 6 },
  loadingTitle: { fontFamily: font.display, fontSize: 24, letterSpacing: -0.5, color: color.fg },
  loadingText: { fontFamily: font.sans, fontSize: 14.5, lineHeight: 21, color: color.fg2, textAlign: "center", maxWidth: 280 },
  errorCard: { padding: 20, gap: 12 },
  errorTitle: { fontFamily: font.display, fontSize: 22, letterSpacing: -0.4, color: color.fg },
  errorText: { fontFamily: font.sans, fontSize: 14.5, lineHeight: 21, color: color.fg2 },
  errorActions: { flexDirection: "row", gap: 10, marginTop: 6 },
});
