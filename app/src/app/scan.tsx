import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import Ionicons from "@expo/vector-icons/Ionicons";
import { reasonText, useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { flush, lastFlushTrace, lastSendError, newEvent, pending, submit, type SendError } from "../lib/queue";
import { describeOutcome, scanView, type Outcome, type ScanView } from "../lib/outcome";
import { api, ApiError, type CatalogItem } from "../lib/api";
import type { MemberInfo } from "../lib/member";
import { checkinTarget, parseQr } from "../lib/qr";
import { metersBetween } from "../lib/geo";
import { Button, Card, Chip, Eyebrow, Field, H2, P, Pill, Progress, type IconName } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { Confetti } from "../components/Confetti";
import { colors, radius, serif, space } from "../lib/theme";

const CONFIRM_ERRORS: Record<string, [string, string]> = {
  unknown_code: ["Ο κωδικός δεν βρέθηκε ή έχει ήδη χρησιμοποιηθεί.", "Code not found or already used."],
  code_expired: ["Ο κωδικός έληξε. Ο επισκέπτης μπορεί να ζητήσει νέο.", "The code has expired. The visitor can ask for a new one."],
  reward_belongs_to_another_member: ["Η ανταμοιβή ανήκει σε άλλη επιχείρηση.", "This reward belongs to another business."],
  not_enough_points: ["Ο επισκέπτης δεν έχει πλέον αρκετούς πόντους.", "The visitor no longer has enough points."],
};

/** The engine's distance check for a QR scan (engine/src/pipeline.ts, LIMITS.qrMaxDistanceM). */
const QR_MAX_DISTANCE_M = 500;

type Geo = { lat: number; lng: number; accuracy_m?: number };

/**
 * The phone's location to send with a scan. The engine refuses a scan at a place with coordinates
 * when none comes with it, so ask for permission here and fall back to a recent last-known fix.
 */
async function quickPosition(): Promise<Geo | undefined> {
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

interface Result {
  view: ScanView;
  outcome: Outcome | null;
  place: CatalogItem | null;
  geo?: Geo;
  balance?: number | null;
  waiting?: number;
  sendError?: SendError | null;
  trace?: string;
}

const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

function SheetIcon({ name, tone }: { name: IconName; tone: "green" | "burgundy" | "sky" | "sand" }) {
  const bg = { green: colors.greenSoft, burgundy: colors.burgundySoft, sky: colors.skySoft, sand: colors.sand }[tone];
  const fg = { green: colors.green, burgundy: colors.burgundy, sky: colors.greenDark, sand: colors.brown }[tone];
  return (
    <View style={[styles.sheetIcon, { backgroundColor: bg }]}>
      <Ionicons name={name} size={34} color={fg} />
    </View>
  );
}

function Tip({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={styles.tip}>
      <Ionicons name={icon} size={20} color={colors.brown} />
      <View style={{ flex: 1 }}>
        <Text style={styles.tipTitle}>{title}</Text>
        <P muted>{text}</P>
      </View>
    </View>
  );
}

/** Success: the passport stamp, confetti, points and the new balance. */
function SuccessBody({ r, onPassport, onClose }: { r: Result; onPassport: () => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const el = lang === "el";
  const o = r.outcome?.kind === "ok" ? r.outcome : null;
  const date = new Intl.DateTimeFormat(el ? "el-GR" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date()).toUpperCase();
  return (
    <View style={{ alignItems: "center", gap: space.md }}>
      <View>
        <Pill tone="solid" icon="checkmark-circle" label={el ? "Επιτυχής σάρωση" : "Scan successful"} />
      </View>
      <View style={styles.stamp}>
        <View style={styles.stampInner}>
          <Ionicons name={r.place?.kind === "business" ? "storefront" : "location"} size={26} color={colors.brown} />
          <Text style={styles.stampTitle} numberOfLines={3}>
            {r.place?.title ?? (el ? "Επίσκεψη" : "Visit")}
          </Text>
          <Text style={styles.stampDate}>{date}</Text>
          {r.place?.subtitle ? (
            <Text style={styles.stampSub} numberOfLines={1}>
              {r.place.subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.seal}>
          <Ionicons name="ribbon" size={18} color="#fff" />
        </View>
      </View>
      {o && (
        <View>
          <Pill icon="leaf" label={`+${o.points} ${t.points}`} />
        </View>
      )}
      {r.balance != null && <P muted>{`${el ? "Νέο υπόλοιπο" : "New balance"}: ${r.balance.toLocaleString("el-GR")} ${t.points}`}</P>}
      <H2 style={{ textAlign: "center" }}>{el ? "Η σφραγίδα μπήκε στο Διαβατήριό σας!" : "Stamp added to your Passport!"}</H2>
      {o?.extra.includes("route.completed") && (
        <Card style={{ backgroundColor: colors.green, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Ionicons name="ribbon" size={24} color="#fff" />
          <P style={{ color: "#fff", fontWeight: "700", flex: 1 }}>{el ? "Ολοκληρώσατε μια διαδρομή!" : "You completed a route!"}</P>
        </Card>
      )}
      {o?.extra.includes("referral.redeemed") && <P muted>{el ? "Η σύσταση καταγράφηκε." : "Referral recorded."}</P>}
      <View style={{ alignSelf: "stretch", gap: space.sm }}>
        <Button icon="book" title={el ? "Προβολή στο Διαβατήριο" : "View in Passport"} onPress={onPassport} />
        <Button kind="secondary" icon="compass-outline" title={el ? "Συνέχεια" : "Keep exploring"} onPress={onClose} />
      </View>
    </View>
  );
}

/** Too far: how far the phone was from the place, against the allowed distance. */
function TooFarBody({ r, onClose }: { r: Result; onClose: () => void }) {
  const { lang } = useI18n();
  const el = lang === "el";
  const p = r.place;
  const d = p?.lat != null && p?.lng != null && r.geo ? metersBetween(r.geo, { lat: p.lat, lng: p.lng }) : null;
  return (
    <View style={{ gap: space.md }}>
      <SheetIcon name="walk" tone="burgundy" />
      <H2>{el ? "Βρίσκεστε πολύ μακριά" : "You're too far away"}</H2>
      <P muted>
        {el
          ? "Η σφραγίδα δίνεται μόνο στο ίδιο το σημείο. Πλησιάστε και σαρώστε ξανά."
          : "The stamp is only given at the place itself. Get closer and scan again."}
      </P>
      {p && (
        <Card>
          <Eyebrow>{el ? "Σημείο" : "Place"}</Eyebrow>
          <Text style={styles.placeTitle}>{p.title}</Text>
          {d != null && (
            <View style={{ gap: space.sm, marginTop: space.xs }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <P muted>{el ? "Απόσταση" : "Distance"}</P>
                <P style={{ fontWeight: "800", color: colors.burgundy }}>{distanceText(d)}</P>
              </View>
              <Progress value={QR_MAX_DISTANCE_M / Math.max(d, QR_MAX_DISTANCE_M)} color={colors.greenBright} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.scale}>{`${el ? "Επιτρέπεται έως" : "Allowed up to"} ${QR_MAX_DISTANCE_M} m`}</Text>
                <Text style={styles.scale}>{el ? "Εσείς" : "You"}</Text>
              </View>
            </View>
          )}
        </Card>
      )}
      {p?.lat != null && p?.lng != null && (
        <Button
          icon="navigate"
          title={el ? "Οδηγίες προς το σημείο" : "Directions to the place"}
          onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`)}
        />
      )}
      <Button kind="secondary" icon="refresh" title={el ? "Δοκιμή ξανά" : "Try again"} onPress={onClose} />
    </View>
  );
}

function LocationBody({ r, onClose }: { r: Result; onClose: () => void }) {
  const { lang } = useI18n();
  const el = lang === "el";
  const inaccurate = r.outcome?.kind === "rejected" && r.outcome.reason === "geo_inaccurate";
  return (
    <View style={{ gap: space.md }}>
      <SheetIcon name="location" tone="sky" />
      <H2>{inaccurate ? (el ? "Το GPS δεν είναι αρκετά ακριβές" : "GPS isn't accurate enough") : el ? "Χρειάζεται η τοποθεσία σας" : "Your location is needed"}</H2>
      <P muted>
        {el
          ? "Για να μετρήσει η επίσκεψη, η εφαρμογή επιβεβαιώνει ότι βρίσκεστε στο σημείο τη στιγμή της σάρωσης."
          : "For the visit to count, the app confirms you're at the place at the moment you scan."}
      </P>
      <Tip
        icon="shield-checkmark-outline"
        title={el ? "Το απόρρητό σας" : "Your privacy"}
        text={el ? "Δεν καταγράφουμε διαδρομές. Η θέση στέλνεται μόνο μαζί με τη σάρωση." : "We don't track your routes. Your position is only sent with the scan."}
      />
      <Tip
        icon="locate-outline"
        title={el ? "Ακριβής τοποθεσία" : "Precise location"}
        text={el ? "Επιλέξτε «Κατά τη χρήση της εφαρμογής» και ενεργοποιήστε την ακριβή τοποθεσία. Σε ανοιχτό χώρο το GPS είναι πιο ακριβές." : "Choose “While using the app” and turn on precise location. GPS works best in the open."}
      />
      {!inaccurate && <Button icon="settings-outline" title={el ? "Άνοιγμα ρυθμίσεων" : "Open settings"} onPress={() => void Linking.openSettings()} />}
      <Button kind="secondary" icon="refresh" title={el ? "Δοκιμή ξανά" : "Try again"} onPress={onClose} />
    </View>
  );
}

function InvalidBody({ r, onClose }: { r: Result; onClose: () => void }) {
  const { t, lang } = useI18n();
  const el = lang === "el";
  const reason = r.outcome?.kind === "rejected" ? r.outcome.reason : undefined;
  return (
    <View style={{ gap: space.md }}>
      <SheetIcon name="qr-code" tone="burgundy" />
      <H2>{el ? "Ο κωδικός δεν αναγνωρίστηκε" : "Code not recognised"}</H2>
      <P muted>{reason ? reasonText(reason, lang) : t.notOurQr}</P>
      <Eyebrow>{el ? "Συμβουλές" : "Tips"}</Eyebrow>
      <Tip
        icon="sunny-outline"
        title={el ? "Αντανάκλαση ή σκιά" : "Glare or shadow"}
        text={el ? "Μετακινηθείτε λίγο ώστε ο ήλιος να μη θαμπώνει την κάμερα." : "Move a little so the sun doesn't dazzle the camera."}
      />
      <Tip
        icon="restaurant-outline"
        title={el ? "Άλλος κωδικός" : "A different code"}
        text={el ? "Βεβαιωθείτε ότι δεν σαρώσατε το μενού ή το Wi-Fi του καταστήματος." : "Make sure it isn't the shop's menu or Wi-Fi code."}
      />
      <Tip
        icon="scan-outline"
        title={el ? "Απόσταση" : "Distance"}
        text={el ? "Κρατήστε το κινητό 15 με 20 εκατοστά από τον κωδικό." : "Hold the phone 15 to 20 cm from the code."}
      />
      <Button icon="camera-outline" title={el ? "Σάρωση ξανά" : "Scan again"} onPress={onClose} />
    </View>
  );
}

function QueuedBody({ r, onClose, onRetry, onSignIn }: { r: Result; onClose: () => void; onRetry: () => void; onSignIn: () => void }) {
  const { lang } = useI18n();
  const el = lang === "el";
  const err = r.sendError;
  const expired = err?.status === 401;
  const server = !!err && !err.network && !expired;
  const [busy, setBusy] = useState(false);
  const title = expired
    ? el ? "Η σύνδεσή σας έληξε" : "You've been signed out"
    : server
      ? el ? "Ο διακομιστής δεν απάντησε σωστά" : "The server had a problem"
      : el ? "Είστε εκτός σύνδεσης" : "You're offline";
  const text = expired
    ? el ? "Συνδεθείτε ξανά με το email σας. Η σάρωση φυλάχτηκε και θα σταλεί αμέσως μετά." : "Sign in again with your email. The scan is saved and will be sent right after."
    : server
      ? el ? "Η σάρωση φυλάχτηκε στο κινητό και θα ξαναδοκιμάσει αυτόματα. Αν συνεχίσει, στείλτε μας τον κωδικό σφάλματος." : "The scan is saved on your phone and will be retried automatically. If it keeps happening, send us the error code."
      : el ? "Μην ανησυχείτε. Η σάρωση φυλάχτηκε στο κινητό με την ώρα και τη θέση της, και θα σταλεί μόλις υπάρξει σήμα." : "Don't worry. The scan is saved on your phone with its time and position, and will be sent as soon as there's signal.";
  return (
    <View style={{ gap: space.md }}>
      <SheetIcon name={expired ? "person-circle-outline" : server ? "warning-outline" : "cloud-offline"} tone={server || expired ? "burgundy" : "sand"} />
      <H2>{title}</H2>
      <P muted>{text}</P>
      {!expired && (
        <Tip
          icon="sync-outline"
          title={el ? "Αυτόματος συγχρονισμός" : "Sends by itself"}
          text={el ? "Οι πόντοι μπαίνουν στο Πορτοφόλι όταν σταλεί η σάρωση." : "The points reach your Wallet once the scan is sent."}
        />
      )}
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        {!!r.waiting && <Pill tone="sand" icon="hourglass-outline" label={`${r.waiting} ${el ? "σε αναμονή αποστολής" : "waiting to send"}`} />}
        {err && <Pill tone="burgundy" icon="information-circle-outline" label={err.status ? `${err.status} ${err.code}` : err.code} />}
      </View>
      {r.trace ? <Text style={styles.trace}>{r.trace}</Text> : null}
      {expired ? (
        <Button icon="log-in-outline" title={el ? "Σύνδεση" : "Sign in"} onPress={onSignIn} />
      ) : (
        <Button
          icon="refresh"
          busy={busy}
          title={el ? "Αποστολή τώρα" : "Send now"}
          onPress={async () => {
            setBusy(true);
            await onRetry();
            setBusy(false);
          }}
        />
      )}
      <Button kind="secondary" title={el ? "Εντάξει" : "OK"} onPress={onClose} />
    </View>
  );
}

function SimpleBody({ icon, tone, title, text, onClose }: { icon: IconName; tone: "green" | "burgundy" | "sky" | "sand"; title: string; text?: string; onClose: () => void }) {
  const { lang } = useI18n();
  return (
    <View style={{ gap: space.md }}>
      <SheetIcon name={icon} tone={tone} />
      <H2>{title}</H2>
      {text ? <P muted>{text}</P> : null}
      <Button kind="secondary" title={lang === "el" ? "Εντάξει" : "OK"} onPress={onClose} />
    </View>
  );
}

export default function Scan() {
  const { t, lang } = useI18n();
  const el = lang === "el";
  const session = useSession();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [locPerm, setLocPerm] = useState<boolean | null>(null);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [referral, setReferral] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<{ ok: boolean; text: string } | null>(null);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [actingFor, setActingFor] = useState<string | null>(null);
  const lastScan = useRef<{ data: string; at: number } | null>(null);
  const insets = useSafeAreaInsets();

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

  // Only one camera preview may run at a time, so mount it only while this screen is visible.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void Location.getForegroundPermissionsAsync().then((p) => setLocPerm(p.status === "granted"));
      return () => setFocused(false);
    }, []),
  );

  const askLocation = async () => {
    const p = await Location.requestForegroundPermissionsAsync();
    setLocPerm(p.status === "granted");
    if (p.status !== "granted" && !p.canAskAgain) void Linking.openSettings();
  };

  const confirmRedemption = async (code: string) => {
    if (!session.member) {
      setNotice(el ? "Αυτός είναι κωδικός εξαργύρωσης. Τον σαρώνει η επιχείρηση από τον λογαριασμό μέλους της." : "This is a redemption code. The business scans it while signed in to its member account.");
      return;
    }
    try {
      const r = await api<{ reward: string; cost: number }>("/v1/member/redemptions/confirm", {
        method: "POST",
        role: "member",
        body: { member_id: actingFor ?? undefined, code },
      });
      setRedeemed({ ok: true, text: el ? `Επιβεβαιώθηκε: ${r.reward} (−${r.cost} πόντοι)` : `Confirmed: ${r.reward} (−${r.cost} points)` });
    } catch (e) {
      const msg = CONFIRM_ERRORS[e instanceof ApiError ? e.code : ""];
      setRedeemed({ ok: false, text: msg ? msg[el ? 0 : 1] : t.error });
    }
  };

  const onScan = async ({ data }: { data: string }) => {
    if (busy || result) return;
    const now = Date.now();
    const qr = parseQr(data);
    if (qr.kind === "foreign") {
      // Say so instead of ignoring it silently, e.g. a menu or Wi-Fi QR.
      if (lastScan.current && lastScan.current.data === data && now - lastScan.current.at < 5000) return;
      lastScan.current = { data, at: now };
      setResult({ view: "invalid", outcome: null, place: null });
      return;
    }
    if (lastScan.current && lastScan.current.data === data && now - lastScan.current.at < 5000) return;
    lastScan.current = { data, at: now };
    setBusy(true);
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
    const target = checkinTarget(qr.token);
    const placeP = target ? api<CatalogItem>(`/v1/catalog/item/${target}?lang=${lang}`).catch(() => null) : Promise.resolve(null);
    try {
      const geo = await quickPosition();
      const ev = newEvent("checkin.qr", {
        geo,
        payload: { qr_token: data, ...(referral.trim() ? { referral_code: referral.trim().toUpperCase() } : {}) },
      });
      const outcome = describeOutcome(await submit(ev));
      const view = scanView(outcome);
      const [place, balance, waiting] = await Promise.all([
        // Offline, the place and balance can't load; the sheet doesn't need them.
        view === "queued" ? Promise.resolve(null) : placeP,
        view === "success" ? api<{ balance: number }>("/v1/me/wallet", { role: "visitor" }).then((w) => w.balance).catch(() => null) : Promise.resolve(null),
        view === "queued" ? pending().then((p) => p.length) : Promise.resolve(0),
      ]);
      const sendError = view === "queued" ? lastSendError() : null;
      // A refused refresh token signs the visitor out on the device; let the rest of the app know.
      if (sendError?.status === 401) void session.reload();
      setResult({ view, outcome, place, geo, balance, waiting, sendError, trace: view === "queued" ? lastFlushTrace() : undefined });
      setReferral("");
    } catch {
      setResult({ view: "other", outcome: null, place: null });
    } finally {
      setBusy(false);
    }
  };

  const close = () => setResult(null);

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
        <Card style={{ alignItems: "center" }}>
          <SheetIcon name="camera" tone="green" />
          <P style={{ textAlign: "center" }}>{t.cameraPermission}</P>
          <Button title={t.allow} onPress={requestPermission} style={{ alignSelf: "stretch" }} />
        </Card>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.greenDark }}>
      <View style={styles.camWrap}>
        {focused && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={busy || result ? undefined : onScan}
          />
        )}
        <View style={styles.topRow} pointerEvents="box-none">
          {session.visitor && locPerm !== null && (
            <Pressable onPress={locPerm ? undefined : askLocation} style={[styles.status, !locPerm && { backgroundColor: colors.burgundy }]}>
              <Ionicons name={locPerm ? "location" : "location-outline"} size={14} color="#fff" />
              <Text style={styles.statusText}>{locPerm ? (el ? "Τοποθεσία ενεργή" : "Location on") : el ? "Ενεργοποιήστε την τοποθεσία" : "Turn on location"}</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.frame} pointerEvents="none">
          <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 }]} />
          <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 }]} />
          <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 }]} />
          <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 }]} />
        </View>
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>
            {busy
              ? t.checking
              : session.member
                ? el
                  ? "Σαρώστε το QR εξαργύρωσης του επισκέπτη ή ένα QR σημείου"
                  : "Scan the visitor's redemption QR or a place's QR"
                : t.scanHelp}
          </Text>
        </View>
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + space.lg }]}>
        {members.length > 1 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {members.map((m) => (
              <Chip key={m.id} label={m.name} active={m.id === actingFor} onPress={() => setActingFor(m.id)} />
            ))}
          </View>
        )}
        {session.visitor && (
          <Field
            label={t.referralCode}
            icon="gift-outline"
            value={referral}
            onChangeText={setReferral}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
          />
        )}
        {!busy && notice && (
          <Card>
            <P>{notice}</P>
            {!session.visitor && notice === t.loginHelp && <Button title={t.verify} onPress={() => router.push("/login")} />}
          </Card>
        )}
        {!busy && redeemed && (
          <Card style={{ backgroundColor: redeemed.ok ? colors.greenBright : colors.burgundySoft, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Ionicons name={redeemed.ok ? "checkmark-circle" : "alert-circle"} size={24} color={redeemed.ok ? "#fff" : colors.burgundy} />
            <P style={{ color: redeemed.ok ? "#fff" : colors.burgundy, fontWeight: "700", flex: 1 }}>{redeemed.text}</P>
          </Card>
        )}
      </View>

      <Sheet visible={!!result} onClose={close} overlay={result?.view === "success" ? <Confetti /> : undefined}>
        {result?.view === "success" && (
          <SuccessBody
            r={result}
            onClose={close}
            onPassport={() => {
              close();
              router.navigate("/passport");
            }}
          />
        )}
        {result?.view === "too_far" && <TooFarBody r={result} onClose={close} />}
        {result?.view === "location" && <LocationBody r={result} onClose={close} />}
        {result?.view === "invalid" && <InvalidBody r={result} onClose={close} />}
        {result?.view === "queued" && (
          <QueuedBody
            r={result}
            onClose={close}
            onSignIn={() => {
              close();
              router.push("/login");
            }}
            onRetry={async () => {
              const before = result.waiting ?? 0;
              await flush();
              const waiting = (await pending()).length;
              if (waiting < before && !lastSendError()) close();
              else setResult({ ...result, waiting, sendError: lastSendError(), trace: lastFlushTrace() });
            }}
          />
        )}
        {result?.view === "duplicate" && <SimpleBody icon="checkmark-done" tone="green" title={t.checkinDuplicate} text={el ? "Μία σφραγίδα ανά σημείο την ημέρα. Τα λέμε αύριο!" : "One stamp per place per day. See you tomorrow!"} onClose={close} />}
        {result?.view === "other" && (
          <SimpleBody
            icon="alert-circle"
            tone="burgundy"
            title={result.outcome ? t.checkinRejected : t.checkinError}
            text={result.outcome?.kind === "rejected" ? reasonText(result.outcome.reason, lang) : undefined}
            onClose={close}
          />
        )}
      </Sheet>
    </View>
  );
}

const FRAME = 240;
const styles = StyleSheet.create({
  pad: { padding: space.lg, gap: space.md },
  camWrap: { flex: 1, minHeight: 360, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  topRow: { position: "absolute", top: space.md, left: space.md, right: space.md, flexDirection: "row", justifyContent: "center" },
  status: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(28,44,35,0.75)", borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12 },
  statusText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  frame: { width: FRAME, height: FRAME },
  corner: { position: "absolute", width: 44, height: 44, borderColor: colors.sky },
  hint: { position: "absolute", bottom: space.lg, left: space.xl, right: space.xl, alignItems: "center" },
  hintText: { color: "#fff", fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  panel: { padding: space.lg, gap: space.md, backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, marginTop: -radius.lg },
  sheetIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  tip: { flexDirection: "row", gap: space.md, alignItems: "flex-start", backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  tipTitle: { fontSize: 14, fontWeight: "800", color: colors.greenDark },
  stamp: { width: 190, height: 190, borderRadius: 95, borderWidth: 3, borderColor: colors.brown, borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: colors.sand },
  stampInner: { width: 166, height: 166, borderRadius: 83, borderWidth: 1.5, borderColor: colors.brown, alignItems: "center", justifyContent: "center", padding: space.md, gap: 4 },
  stampTitle: { fontFamily: serif, fontSize: 15, lineHeight: 19, fontWeight: "700", color: colors.greenDark, textAlign: "center" },
  stampDate: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: colors.brown },
  stampSub: { fontSize: 11, color: colors.textMuted },
  seal: { position: "absolute", right: 6, bottom: 14, width: 38, height: 38, borderRadius: 19, backgroundColor: colors.burgundy, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: colors.background },
  placeTitle: { fontFamily: serif, fontSize: 17, lineHeight: 22, fontWeight: "700", color: colors.greenDark },
  scale: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  trace: { fontSize: 11, lineHeight: 15, color: colors.textMuted, fontFamily: "monospace" },
});
