import { createElement, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import type { MapFrameProps } from "./map-frame";

export type { MapFrameHandle, MapFrameProps } from "./map-frame";

/** Web build (expo export / expo start --web): react-native-webview has no web target, use an iframe. */
export function MapFrame({ url, ref, onLoadStart, onLoaded }: MapFrameProps) {
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useImperativeHandle(ref, () => ({
    reload: () => {
      onLoadStart();
      setNonce((n) => n + 1);
    },
    goBack: () => frame.current?.contentWindow?.history.back(),
  }));

  return (
    <View style={{ flex: 1 }}>
      {createElement("iframe", {
        key: nonce,
        ref: frame,
        src: url,
        title: "Floodograph sel analiz haritası",
        allow: "geolocation; fullscreen",
        onLoad: onLoaded,
        style: { border: 0, width: "100%", height: "100%", background: "#0a0f12" },
      })}
    </View>
  );
}
