import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { reasonText, useI18n } from "../lib/i18n";
import { newEvent, submit } from "../lib/queue";
import { describeOutcome, type Outcome } from "../lib/outcome";
import { Button, Card, P } from "./ui";
import { colors } from "../lib/theme";

const DWELL_S = 120;
const RADIUS_M = 75;

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * "I'm here" for places without a QR code: watches the phone's position while
 * the visitor stays near the place for two minutes, then sends a GPS check-in.
 * The engine checks distance, accuracy and dwell again on its side.
 */
export function GeoCheckin({ poiId, lat, lng }: { poiId: string; lat: number; lng: number }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<"idle" | "waiting" | "sending" | "done">("idle");
  const [left, setLeft] = useState(DWELL_S);
  const [note, setNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);
  const since = useRef<number | null>(null);

  useEffect(() => () => sub.current?.remove(), []);

  const start = async () => {
    setNote(null);
    setOutcome(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return setNote(lang === "el" ? "Χρειάζεται η τοποθεσία." : "Location is needed.");
    setState("waiting");
    since.current = null;
    sub.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 }, async (pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const acc = pos.coords.accuracy ?? 999;
      const d = meters(here, { lat, lng });
      if (d > RADIUS_M || acc > 50) {
        since.current = null;
        setLeft(DWELL_S);
        setNote(acc > 50 ? reasonText("geo_inaccurate", lang) : `${Math.round(d)} m — ${reasonText("geo_too_far", lang)}`);
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
        const res = await submit(newEvent("checkin.geo", { poi_id: poiId, geo: { ...here, accuracy_m: acc }, payload: { dwell_seconds: dwell } }));
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

  return (
    <Card>
      <P muted>{t.imHereHelp}</P>
      {state === "idle" || state === "done" ? (
        <Button title={t.imHere} onPress={start} />
      ) : (
        <>
          <P style={{ fontWeight: "700" }}>{state === "sending" ? t.loading : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</P>
          <Button kind="secondary" title={lang === "el" ? "Ακύρωση" : "Cancel"} onPress={cancel} />
        </>
      )}
      {note && <P muted>{note}</P>}
      {outcome?.kind === "ok" && <P style={{ color: colors.greenBright, fontWeight: "700" }}>{`${t.checkinOk} +${outcome.points} ${t.points}`}</P>}
      {outcome?.kind === "duplicate" && <P>{t.checkinDuplicate}</P>}
      {outcome?.kind === "queued" && <P>{t.checkinQueued}</P>}
      {outcome?.kind === "rejected" && <P style={{ color: colors.burgundy }}>{reasonText(outcome.reason, lang)}</P>}
    </Card>
  );
}
