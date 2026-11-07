import { useCallback } from "react";
import { Image, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { CityCard } from "@/components/city-card";
import { GlassScene } from "@/components/glass";
import { Rise } from "@/components/motion";
import { TierSummary } from "@/components/tier-summary";
import { Arrow, Button, Eyebrow } from "@/components/ui";
import { useOverview } from "@/lib/useOverview";
import { color, font, SITE_URL } from "@/theme";

const LOGO = require("../assets/images/floodograph-logo.png");

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, reload } = useOverview();
  const openMap = useCallback(() => router.push("/harita"), [router]);

  return (
    <GlassScene backdrop={<Backdrop />}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 36 }]}
        refreshControl={
          <RefreshControl
            refreshing={state.status === "loading" && state.data != null}
            onRefresh={reload}
            tintColor={color.ember}
            colors={[color.ember]}
            progressBackgroundColor={color.surface}
          />
        }
      >
        <Rise>
          <Image
            source={LOGO}
            style={styles.logo}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Floodograph"
          />
        </Rise>

        <Rise delay={80} style={styles.hero}>
          <Eyebrow tone="ember">14.10.2026 · İstanbul · Sarıyer–Ayazağa</Eyebrow>
          <Text style={styles.h1} accessibilityRole="header">
            Su yolunu her zaman bulur. <Text style={{ color: color.ember }}>Biz önce buluruz.</Text>
          </Text>
          <Text style={styles.lead}>
            Floodograph, şehrin altına gömülen dereleri açık yükseklik verisinden yeniden çizer, 14 Ekim selini gerçek
            yağışla saat saat oynatır ve hangi binaya önce gidilmesi gerektiğini söyler.
          </Text>
        </Rise>

        <Rise delay={180} style={styles.actions}>
          <Button
            label="Haritayı aç"
            onPress={openMap}
            icon={<Arrow />}
            accessibilityHint="Sel analiz haritasını açar"
            style={{ flex: 1 }}
          />
          <Button label="Web sitesi" variant="ghost" onPress={() => void Linking.openURL(SITE_URL)} />
        </Rise>

        <Rise delay={280}>
          <CityCard city={state.data?.city ?? null} buildings={state.data?.total ?? null} onOpenMap={openMap} />
        </Rise>

        <Rise delay={360}>
          <TierSummary state={state} onRetry={reload} />
        </Rise>

        <Rise delay={440} style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerText}>Takım SALU · EkoZeka 2026</Text>
          <Text style={styles.footerNote}>
            Veriler açık kaynaklardan (FABDEM, OpenStreetMap) türetilir. Acil durumlarda 112&apos;yi arayın.
          </Text>
        </Rise>
      </ScrollView>
    </GlassScene>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 22 },
  logo: { width: 150, height: (150 * 504) / 735, marginLeft: -6 },
  hero: { gap: 16 },
  h1: {
    fontFamily: font.display,
    fontSize: 42,
    lineHeight: 42,
    letterSpacing: -1.5,
    color: color.fg,
    paddingTop: 4,
  },
  lead: { fontFamily: font.sans, fontSize: 16.5, lineHeight: 25, color: color.fg2 },
  actions: { flexDirection: "row", gap: 10 },
  footer: { gap: 8, paddingTop: 6 },
  footerLine: { height: StyleSheet.hairlineWidth * 2, backgroundColor: color.line, marginBottom: 8 },
  footerText: { fontFamily: font.mono, fontSize: 12, letterSpacing: 0.6, color: color.fg3 },
  footerNote: { fontFamily: font.sans, fontSize: 12.5, lineHeight: 18, color: color.fg3 },
});
