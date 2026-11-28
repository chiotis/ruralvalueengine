import { useEffect, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import QRCode from "qrcode";
import { colors } from "../lib/theme";

/** A QR code drawn as SVG inside a WebView, white background so any phone camera can read it. */
export function QrImage({ value, size }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: colors.ink, light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [value]);
  if (!svg) return null;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}svg{width:92%;height:auto}</style></head><body>${svg}</body></html>`;
  return (
    <View style={{ width: size ?? "100%", aspectRatio: 1, backgroundColor: "#fff" }}>
      <WebView originWhitelist={["*"]} source={{ html }} scrollEnabled={false} />
    </View>
  );
}
