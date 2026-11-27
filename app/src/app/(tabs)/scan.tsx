import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { reasonText, useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { lastFlushError, newEvent, submit } from "../../lib/queue";
import { describeOutcome, type Outcome } from "../../lib/outcome";
import { Button, Card, Field, H2, P } from "../../components/ui";
import { colors, radius, space } from "../../lib/theme";

const QR_PREFIX = "rve://c/";

/** Best-effort location to send with a scan: never blocks the check-in for long. */
async function quickPosition() {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") return undefined;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    if (!pos) return undefined;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy ?? undefined };
  } catch {
    return undefined;
  }
}

export default function Scan() {
  const { t, lang } = useI18n();
  const session = useSession();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [referral, setReferral] = useState("");
  const [outcome, setOutcome] = useState<Outcome | "error" | null>(null);
  const [foreign, setForeign] = useState(false);
  const lastScan = useRef<{ data: string; at: number } | null>(null);

  // Only one camera preview may run at a time, so mount it only while this tab is visible.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const onScan = async ({ data }: { data: string }) => {
    if (busy) return;
    const now = Date.now();
    if (!data.startsWith(QR_PREFIX)) {
      // Tell the visitor instead of ignoring it silently, e.g. a menu or Wi-Fi QR.
      setForeign(true);
      setOutcome(null);
      return;
    }
    setForeign(false);
    if (lastScan.current && lastScan.current.data === data && now - lastScan.current.at < 5000) return;
    lastScan.current = { data, at: now };
    setBusy(true);
    setOutcome(null);
    try {
      const geo = await quickPosition();
      const ev = newEvent("checkin.qr", {
        geo,
        payload: { qr_token: data, ...(referral.trim() ? { referral_code: referral.trim().toUpperCase() } : {}) },
      });
      setOutcome(describeOutcome(await submit(ev)));
      setReferral("");
    } catch {
      setOutcome("error");
    } finally {
      setBusy(false);
    }
  };

  if (!session.visitor) {
    return (
      <View style={styles.pad}>
        <Card>
          <H2>{t.loginTitle}</H2>
          <P muted>{t.loginHelp}</P>
          <Button title={t.verify} onPress={() => router.push("/login")} />
        </Card>
      </View>
    );
  }
  if (!permission) return <View style={styles.pad} />;
  if (!permission.granted) {
    return (
      <View style={styles.pad}>
        <Card>
          <P>{t.cameraPermission}</P>
          <Button title={t.allow} onPress={requestPermission} />
        </Card>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.camWrap}>
        {focused && (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={busy ? undefined : onScan} />
        )}
        <View style={styles.frame} pointerEvents="none" />
      </View>
      <View style={[styles.pad, { gap: space.md }]}>
        <P muted>{t.scanHelp}</P>
        <Field label={t.referralCode} value={referral} onChangeText={setReferral} autoCapitalize="characters" autoCorrect={false} maxLength={12} />
        {busy && (
          <Card>
            <P>{t.checking}</P>
          </Card>
        )}
        {!busy && foreign && !outcome && (
          <Card>
            <P>{t.notOurQr}</P>
          </Card>
        )}
        {!busy && outcome === "error" && (
          <Card style={{ borderColor: colors.burgundy, borderWidth: 2 }}>
            <P>{t.checkinError}</P>
          </Card>
        )}
        {!busy && outcome && outcome !== "error" && (
          <Card style={{ borderColor: outcome.kind === "ok" ? colors.greenBright : outcome.kind === "rejected" ? colors.burgundy : colors.border, borderWidth: 2 }}>
            {outcome.kind === "ok" && (
              <>
                <H2>{t.checkinOk}</H2>
                <P>{`+${outcome.points} ${t.points}`}</P>
                {outcome.extra.includes("referral.redeemed") && <P muted>{lang === "el" ? "Η σύσταση καταγράφηκε." : "Referral recorded."}</P>}
                {outcome.extra.includes("route.completed") && <P muted>{lang === "el" ? "Ολοκληρώσατε μια διαδρομή! 🎉" : "You completed a route! 🎉"}</P>}
              </>
            )}
            {outcome.kind === "duplicate" && <P>{t.checkinDuplicate}</P>}
            {outcome.kind === "queued" && (
              <>
                <P>{t.checkinQueued}</P>
                {lastFlushError && <P muted>{lastFlushError}</P>}
              </>
            )}
            {outcome.kind === "rejected" && (
              <>
                <H2>{t.checkinRejected}</H2>
                <P muted>{reasonText(outcome.reason, lang)}</P>
              </>
            )}
          </Card>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: space.lg, gap: space.md },
  camWrap: { height: 320, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  frame: { width: 220, height: 220, borderWidth: 3, borderColor: colors.sky, borderRadius: radius.lg },
});
