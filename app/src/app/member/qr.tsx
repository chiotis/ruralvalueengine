import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { WebView } from "react-native-webview";
import QRCode from "qrcode";
import { useI18n } from "../../lib/i18n";
import { useMember } from "../../lib/member";
import { useApi } from "../../lib/useApi";
import { Card, P, State } from "../../components/ui";
import { colors, space } from "../../lib/theme";

function QrImage({ value }: { value: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: colors.greenDark, light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [value]);
  if (!svg) return null;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}svg{width:92%;height:auto}</style></head><body>${svg}</body></html>`;
  return (
    <View style={{ width: "100%", aspectRatio: 1, backgroundColor: "#fff" }}>
      <WebView originWhitelist={["*"]} source={{ html }} scrollEnabled={false} />
    </View>
  );
}

export default function MemberQr() {
  const { lang } = useI18n();
  const { q, current } = useMember();
  const res = useApi<{ qr_codes: { id: string; kind: string; qr: string }[] }>(current ? q("/v1/member/qr") : null, "member");
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <P muted>
        {lang === "el"
          ? "Τυπώστε ή δείξτε αυτόν τον κωδικό. Οι επισκέπτες τον σαρώνουν με την εφαρμογή για να καταγραφεί η επίσκεψη."
          : "Print or show this code. Visitors scan it in the app to record their visit."}
      </P>
      <State
        loading={res.loading}
        error={res.error}
        onRetry={res.reload}
        empty={!res.loading && !res.data?.qr_codes.length && (lang === "el" ? "Δεν έχει δημιουργηθεί ακόμα κωδικός QR. Επικοινωνήστε με το δίκτυο." : "No QR code yet. Please contact the network.")}
      />
      {res.data?.qr_codes.map((c) => (
        <Card key={c.id}>
          <QrImage value={c.qr} />
          <P muted style={{ textAlign: "center" }}>{c.id}</P>
        </Card>
      ))}
    </ScrollView>
  );
}
