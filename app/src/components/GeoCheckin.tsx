import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";
import { reasonText, useI18n } from "../lib/i18n";
import { newEvent, submit } from "../lib/queue";
import { describeOutcome, type Outcome } from "../lib/outcome";
import { metersBetween } from "../lib/geo";
import { VISITOR_POINTS } from "../lib/points";
import { Button, Card, Eyebrow, P, Pill } from "./ui";
import { colors, serif, space } from "../lib/theme";

// The engine checks the same limits again (engine/src/pipeline.ts LIMITS, default POI radius).
const DWELL_S = 120;
const RADIUS_M = 75;
const MAX_ACCURACY_M = 50;

const RING = 132;
const STROKE = 10;

/** Countdown ring: fills as the visitor stays in range. */
function Ring({ left, active }: { left: number; active: boolean }) {
  const r = (RING - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const done = 1 - left / DWELL_S;
  return (
    <View style={{ width: RING, height: RING, alignItems: "center", justifyContent: "center" }}>
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colors.sand} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={active ? colors.greenBright : colors.border}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - done)}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
      <Text style={styles.time}>{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</Text>
      <Text style={styles.of}>{`/ 2:00`}</Text>
    </View>
  );
}

/**
 * "I'm here" for places without a QR code: watches the phone's position while
 * the visitor stays near the place for two minutes, then sends a GPS check-in.
 * The engine checks distance, accuracy and dwell again on its side.
 */
export function GeoCheckin({ poiId, lat, lng }: { poiId: string; lat: number; lng: number }) {
  const { t, lang } = useI18n();
  const el = lang === "el";
  const [state, setState] = useState<"idle" | "waiting" | "sending" | "done">("idle");
  const [left, setLeft] = useState(DWELL_S);
  const [dist, setDist] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);
  const since = useRef<number | null>(null);

  useEffect(() => () => sub.current?.remove(), []);

  const start = async () => {
    setNote(null);
    setOutcome(null);
    setDist(null);
    setAcc(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return setNote(el ? "Χρειάζεται η τοποθεσία." : "Location is needed.");
    setState("waiting");
    since.current = null;
    sub.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 }, async (pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const a = pos.coords.accuracy ?? 999;
      const d = metersBetween(here, { lat, lng });
      setDist(d);
      setAcc(a);
      if (d > RADIUS_M || a > MAX_ACCURACY_M) {
        since.current = null;
        setLeft(DWELL_S);
        setNote(a > MAX_ACCURACY_M ? reasonText("geo_inaccurate", lang) : reasonText("geo_too_far", lang));
        return;
      }
      setNote(null);
      since.current ??= Date.now();
      const dwell = Math.floor((Date.now() - since.current) / 1000);
      setLeft(Math.max(0, DWELL_S - dwell));
      if (dwell >= DWELL_S && sub.current) {
        sub.current.remove();
        sub.current = null;
        setState("sending");
        const res = await submit(newEvent("checkin.geo", { poi_id: poiId, geo: { ...here, accuracy_m: a }, payload: { dwell_seconds: dwell } }));
        setOutcome(describeOutcome(res));
        setState("done");
      }
    });
  };
  const cancel = () => {
    sub.current?.remove();
    sub.current = null;
    setState("idle");
    setLeft(DWELL_S);
  };

  const inRange = dist != null && dist <= RADIUS_M && (acc ?? 999) <= MAX_ACCURACY_M;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Ionicons name="navigate-circle" size={22} color={colors.green} />
        <Eyebrow color={colors.green}>{el ? "Check-in με GPS" : "GPS check-in"}</Eyebrow>
        <View style={{ flex: 1 }} />
        <Pill icon="leaf" label={`+${VISITOR_POINTS.poiGeo} ${t.points}`} />
      </View>

      {state === "idle" || state === "done" ? (
        <>
          <P muted>{t.imHereHelp}</P>
          {outcome?.kind === "ok" ? (
            <View style={styles.ok}>
              <Ionicons name="checkmark-circle" size={22} color="#fff" />
              <Text style={styles.okText}>{`${t.checkinOk} +${outcome.points} ${t.points}`}</Text>
            </View>
          ) : (
            <Button icon="location" title={t.imHere} onPress={start} />
          )}
        </>
      ) : (
        <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.sm }}>
          <Ring left={left} active={inRange} />
          <Text style={styles.status}>
            {state === "sending"
              ? t.loading
              : inRange
                ? el
                  ? `Μείνετε εντός ${RADIUS_M} μ. Η σφραγίδα έρχεται αυτόματα.`
                  : `Stay within ${RADIUS_M} m. The stamp comes automatically.`
                : el
                  ? "Αναζήτηση θέσης…"
                  : "Finding your position…"}
          </Text>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", justifyContent: "center" }}>
            {dist != null && (
              <Pill tone={dist <= RADIUS_M ? "green" : "burgundy"} icon="navigate-outline" label={`${Math.round(dist)} m ${el ? `(όριο ${RADIUS_M} μ.)` : `(limit ${RADIUS_M} m)`}`} />
            )}
            {acc != null && <Pill tone={acc <= MAX_ACCURACY_M ? "sky" : "burgundy"} icon="radio-outline" label={`GPS ±${Math.round(acc)} m`} />}
          </View>
          <Button kind="ghost" title={el ? "Ακύρωση" : "Cancel"} onPress={cancel} style={{ alignSelf: "stretch" }} />
        </View>
      )}
      {note && <P style={{ color: colors.burgundy }}>{note}</P>}
      {outcome?.kind === "duplicate" && <P>{t.checkinDuplicate}</P>}
      {outcome?.kind === "queued" && <P>{t.checkinQueued}</P>}
      {outcome?.kind === "rejected" && <P style={{ color: colors.burgundy }}>{reasonText(outcome.reason, lang)}</P>}
    </Card>
  );
}

const styles = StyleSheet.create({
  time: { fontFamily: serif, fontSize: 30, lineHeight: 38, fontWeight: "700", color: colors.greenDark },
  of: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  status: { textAlign: "center", fontSize: 14, lineHeight: 20, color: colors.text, fontWeight: "600" },
  ok: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.greenBright, borderRadius: 14, padding: space.md },
  okText: { color: "#fff", fontWeight: "800", fontSize: 15, flex: 1 },
});
