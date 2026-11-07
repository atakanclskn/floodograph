import { useImperativeHandle, useRef, type Ref } from "react";
import { Linking, StyleSheet } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { color } from "@/theme";

export interface MapFrameHandle {
  reload(): void;
  goBack(): void;
}

export interface MapFrameProps {
  url: string;
  ref?: Ref<MapFrameHandle>;
  onLoadStart(): void;
  onProgress(p: number): void;
  onLoaded(): void;
  onFailed(message: string): void;
  onCanGoBack(can: boolean): void;
  /** The page navigated to the site's landing page: leave the map screen instead. */
  onExitToHome(): void;
}

/** origin + pathname without relying on a full WHATWG URL implementation in the JS engine. */
function split(u: string): { origin: string; pathname: string } | null {
  const m = /^(https?:\/\/[^/?#]+)([^?#]*)/i.exec(u);
  return m ? { origin: m[1]!.toLowerCase(), pathname: m[2] ?? "" } : null;
}

/** Native map: the web /demo (MapLibre + WebGL) inside a WebView. Same API as map-frame.web.tsx. */
export function MapFrame({ url, ref, onLoadStart, onProgress, onLoaded, onFailed, onCanGoBack, onExitToHome }: MapFrameProps) {
  // WebView<P> defaults P to undefined, which would collapse its props to never; pin it to {}.
  const web = useRef<WebView<{}>>(null);
  const origin = split(url)?.origin;

  useImperativeHandle(ref, () => ({
    reload: () => web.current?.reload(),
    goBack: () => web.current?.goBack(),
  }));

  const shouldStart = (req: WebViewNavigation & { isTopFrame?: boolean }) => {
    if (req.isTopFrame === false || req.url.startsWith("about:") || req.url.startsWith("data:")) return true;
    const target = split(req.url);
    if (!target) return false;
    if (target.origin === origin) {
      if (target.pathname === "/" || target.pathname === "") {
        onExitToHome();
        return false;
      }
      return true;
    }
    // Anything off-site (sources, OSM attribution, mail links) opens outside the app.
    void Linking.openURL(req.url).catch(() => {});
    return false;
  };

  return (
    <WebView
      ref={web}
      source={{ uri: url }}
      style={styles.web}
      containerStyle={styles.web}
      originWhitelist={["https://*", "about:*", "data:*"]}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      allowsInlineMediaPlayback
      bounces={false}
      overScrollMode="never"
      androidLayerType="hardware"
      webviewDebuggingEnabled={__DEV__}
      onShouldStartLoadWithRequest={shouldStart}
      onLoadStart={onLoadStart}
      onLoadProgress={(e) => onProgress(e.nativeEvent.progress)}
      onLoadEnd={(e) => {
        // onLoadEnd also fires after onError; only a successful load clears the overlay.
        if (!("code" in e.nativeEvent)) onLoaded();
      }}
      onError={(e) => onFailed(e.nativeEvent.description || "Sayfa açılamadı.")}
      onHttpError={(e) => {
        if (e.nativeEvent.statusCode >= 500) onFailed(`Sunucu hatası (HTTP ${e.nativeEvent.statusCode}).`);
      }}
      onNavigationStateChange={(s) => onCanGoBack(s.canGoBack)}
      onRenderProcessGone={() => onFailed("Harita işlemi kapandı. Yeniden yükleyin.")}
      onContentProcessDidTerminate={() => web.current?.reload()}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: color.ink },
});
