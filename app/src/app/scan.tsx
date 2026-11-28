import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { reasonText, useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { lastFlushError, newEvent, submit } from "../lib/queue";
import { describeOutcome, type Outcome } from "../lib/outcome";
import { api, ApiError } from "../lib/api";
import type { MemberInfo } from "../lib/member";
import { parseQr } from "../lib/qr";
import { Button, Card, Chip, Field, H2, P } from "../components/ui";
import { colors, radius, space } from "../lib/theme";

const CONFIRM_ERRORS: Record<string, [string, string]> = {
  unknown_code: ["Ο κωδικός δεν βρέθηκε ή έχει ήδη χρησιμοποιηθεί.", "Code not found or already used."],
  code_expired: ["Ο κωδικός έληξε. Ο επισκέπτης μπορεί να ζητήσει νέο.", "The code has expired. The visitor can ask for a new one."],
  reward_belongs_to_another_member: ["Η ανταμοιβή ανήκει σε άλλη επιχείρηση.", "This reward belongs to another business."],
  not_enough_points: ["Ο επισκέπτης δεν έχει πλέον αρκετούς πόντους.", "The visitor no longer has enough points."],
};

/**
 * The phone's location to send with a scan. The engine refuses a scan at a place with coordinates
 * when none comes with it, so ask for permission here and fall back to a recent last-known fix.
 */
async function quickPosition() {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted" && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return undefined;
    const pos =
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((r) => setTimeout(() => r(null), 8000)),
      ]).catch(() => null)) ?? (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }));
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
  const [notice, setNotice] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<{ ok: boolean; text: string } | null>(null);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [actingFor, setActingFor] = useState<string | null>(null);
  const lastScan = useRef<{ data: string; at: number } | null>(null);

  // A business account confirms redemptions; when one email runs several businesses, the scanner asks which.
  useEffect(() => {
    if (!session.member) return setMembers([]);
    api<{ members: MemberInfo[] }>("/v1/member/me", { role: "member" })
      .then((r) => {
        setMembers(r.members);
        setActingFor((c) => c ?? r.members[0]?.id ?? null);
      })
      .catch(() => setMembers([]));
  }, [session.member]);

  const confirmRedemption = async (code: string) => {
    if (!session.member) {
      setNotice(lang === "el" ? "Αυτός είναι κωδικός εξαργύρωσης. Τον σαρώνει η επιχείρηση από τον λογαριασμό μέλους της." : "This is a redemption code. The business scans it while signed in to its member account.");
      return;
    }
    try {
      const r = await api<{ reward: string; cost: number }>("/v1/member/redemptions/confirm", {
        method: "POST",
        role: "member",
        body: { member_id: actingFor ?? undefined, code },
      });
      setRedeemed({ ok: true, text: lang === "el" ? `Επιβεβαιώθηκε: ${r.reward} (−${r.cost} πόντοι)` : `Confirmed: ${r.reward} (−${r.cost} points)` });
    } catch (e) {
      const msg = CONFIRM_ERRORS[e instanceof ApiError ? e.code : ""];
      setRedeemed({ ok: false, text: msg ? msg[lang === "el" ? 0 : 1] : t.error });
    }
  };

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
    const qr = parseQr(data);
    if (qr.kind === "foreign") {
      // Say so instead of ignoring it silently, e.g. a menu or Wi-Fi QR.
      setForeign(true);
      setOutcome(null);
      setRedeemed(null);
      setNotice(null);
      return;
    }
    setForeign(false);
    if (lastScan.current && lastScan.current.data === data && now - lastScan.current.at < 5000) return;
    lastScan.current = { data, at: now };
    setBusy(true);
    setOutcome(null);
    setRedeemed(null);
    setNotice(null);
    if (qr.kind === "redeem") {
      await confirmRedemption(qr.code);
      setBusy(false);
      return;
    }
    if (!session.visitor) {
      setNotice(t.loginHelp);
      setBusy(false);
      return;
    }
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

  if (!session.visitor && !session.member) {
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
      <ScrollView contentContainerStyle={[styles.pad, { gap: space.md }]} keyboardShouldPersistTaps="handled">
        <P muted>
          {session.member
            ? lang === "el"
              ? "Σαρώστε τον κωδικό QR εξαργύρωσης στο κινητό του επισκέπτη, ή έναν κωδικό QR σημείου για check-in."
              : "Scan the redemption QR on the visitor's phone, or a place's QR to check in."
            : t.scanHelp}
        </P>
        {members.length > 1 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {members.map((m) => (
              <Chip key={m.id} label={m.name} active={m.id === actingFor} onPress={() => setActingFor(m.id)} />
            ))}
          </View>
        )}
        {session.visitor && (
          <Field label={t.referralCode} value={referral} onChangeText={setReferral} autoCapitalize="characters" autoCorrect={false} maxLength={12} />
        )}
        {busy && (
          <Card>
            <P>{t.checking}</P>
          </Card>
        )}
        {!busy && notice && (
          <Card>
            <P>{notice}</P>
            {!session.visitor && notice === t.loginHelp && <Button title={t.verify} onPress={() => router.push("/login")} />}
          </Card>
        )}
        {!busy && redeemed && (
          <Card style={{ backgroundColor: redeemed.ok ? colors.greenBright : colors.surface, borderColor: redeemed.ok ? colors.greenBright : colors.burgundy, borderWidth: 2 }}>
            <P style={{ color: redeemed.ok ? "#fff" : colors.burgundy, fontWeight: "700" }}>{redeemed.text}</P>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: space.lg, gap: space.md },
  camWrap: { height: 320, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  frame: { width: 220, height: 220, borderWidth: 3, borderColor: colors.sky, borderRadius: radius.lg },
});
