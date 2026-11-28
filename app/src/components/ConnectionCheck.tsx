import { useState } from "react";
import { Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, API_URL } from "../lib/api";
import { lastFlushTrace, lastSendError, pending, toSendError } from "../lib/queue";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Button, Card, H2, P } from "./ui";
import { colors, space } from "../lib/theme";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Tries each kind of request the app makes and shows what happened, so a problem on one network
 * (e.g. scans that only fail on a particular Wi-Fi) can be pinned down from the phone.
 */
export function ConnectionCheck() {
  const { lang } = useI18n();
  const el = lang === "el";
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [queueInfo, setQueueInfo] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    const out: Check[] = [];
    const probe = async (name: string, fn: () => Promise<unknown>) => {
      const t0 = Date.now();
      try {
        await fn();
        out.push({ name, ok: true, detail: `${Date.now() - t0} ms` });
      } catch (e) {
        const err = toSendError(e);
        out.push({ name, ok: false, detail: `${err.status ? `${err.status} ` : ""}${err.code} · ${Date.now() - t0} ms` });
      }
      setChecks([...out]);
    };
    await probe("GET /health", () => api("/health"));
    await probe("GET /v1/catalog", () => api("/v1/catalog/routes?limit=1"));
    if (session.visitor) {
      await probe("GET /v1/me/wallet", () => api("/v1/me/wallet", { role: "visitor" }));
      // An empty batch: goes through the same route as a scan without recording anything.
      await probe("POST /v1/events", () => api("/v1/events", { method: "POST", body: { events: [] }, role: "visitor" }));
    }
    const q = await pending();
    const err = lastSendError();
    setQueueInfo(
      [
        `${el ? "Σε αναμονή" : "Waiting"}: ${q.length}`,
        err ? `${el ? "Τελευταίο σφάλμα" : "Last error"}: ${err.status ? `${err.status} ` : ""}${err.code}` : null,
        lastFlushTrace() ? `${el ? "Τελευταία αποστολή" : "Last send"}: ${lastFlushTrace()}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    setBusy(false);
  };

  return (
    <Card>
      <H2>{el ? "Έλεγχος σύνδεσης" : "Connection check"}</H2>
      <P muted>{el ? "Αν οι σαρώσεις μένουν σε αναμονή, τρέξτε τον έλεγχο και στείλτε μας ένα στιγμιότυπο." : "If scans stay waiting, run the check and send us a screenshot."}</P>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{API_URL}</Text>
      {checks?.map((c) => (
        <View key={c.name} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Ionicons name={c.ok ? "checkmark-circle" : "close-circle"} size={18} color={c.ok ? colors.greenBright : colors.burgundy} />
          <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: colors.greenDark }}>{c.name}</Text>
          <Text style={{ fontSize: 12, color: c.ok ? colors.textMuted : colors.burgundy, flexShrink: 1, textAlign: "right" }}>{c.detail}</Text>
        </View>
      ))}
      {queueInfo ? <Text style={{ fontSize: 12, lineHeight: 17, color: colors.textMuted, fontFamily: "monospace" }}>{queueInfo}</Text> : null}
      <Button kind="secondary" icon="pulse" busy={busy} title={el ? "Έλεγχος" : "Run check"} onPress={run} />
    </Card>
  );
}
