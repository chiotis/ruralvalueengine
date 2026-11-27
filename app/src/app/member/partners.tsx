import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { useMember } from "../../lib/member";
import { useApi } from "../../lib/useApi";
import { api, ApiError } from "../../lib/api";
import { Button, Card, H2, P, State } from "../../components/ui";
import { colors, space } from "../../lib/theme";

interface Partnership {
  id: string;
  status: "pending" | "active" | "declined";
  requested_by: string;
  note: string | null;
  partner_id: string;
  partner_name: string;
  created_at: string;
}
interface Match {
  member_id: string;
  name: string;
  score: number;
  distance_km: number | null;
  reasons: string[];
}

const REASON_EL: [RegExp, string][] = [
  [/^([\d.]+) km away$/, "$1 χλμ. μακριά"],
  [/^complementary business type$/, "συμπληρωματική δραστηριότητα"],
  [/^similar business type$/, "παρόμοια δραστηριότητα"],
  [/^same area$/, "ίδια περιοχή"],
  [/^(\d+) shared visitors?$/, "$1 κοινοί επισκέπτες"],
];
const reasonEl = (r: string) => REASON_EL.reduce((s, [re, out]) => (re.test(s) ? s.replace(re, out) : s), r);

export default function MemberPartners() {
  const { t, lang } = useI18n();
  const { q, current } = useMember();
  const list = useApi<{ partnerships: Partnership[] }>(current ? q("/v1/member/partnerships") : null, "member");
  const matches = useApi<{ matches: Match[] }>(current ? q("/v1/member/matches") : null, "member");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    setErr(null);
    try {
      await api(path, { method: "POST", role: "member", body: body ?? { member_id: current } });
      await Promise.all([list.reload(), matches.reload()]);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : (e as Error).message;
      setErr(code === "partnership_exists" ? (lang === "el" ? "Υπάρχει ήδη αίτημα ή συνεργασία." : "A request or partnership already exists.") : code);
    } finally {
      setBusy(null);
    }
  };

  const partnerIds = new Set(list.data?.partnerships.filter((p) => p.status !== "declined").map((p) => p.partner_id));
  const statusText = (s: Partnership["status"]) => (s === "active" ? t.active : s === "pending" ? t.pending : lang === "el" ? "Απορρίφθηκε" : "Declined");

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <P muted>
        {lang === "el"
          ? "Οι συνεργασίες εμφανίζονται στους επισκέπτες και δίνουν +20 πόντους σε κάθε μέλος όταν επιβεβαιωθούν."
          : "Partnerships are shown to visitors and give each member +20 points once confirmed."}
      </P>
      {err && <P style={{ color: colors.burgundy }}>{err}</P>}
      <H2>{t.partners}</H2>
      <State loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!list.loading && !list.data?.partnerships.length && (lang === "el" ? "Καμία συνεργασία ακόμα." : "No partnerships yet.")} />
      {list.data?.partnerships.map((p) => {
        const invited = p.status === "pending" && p.requested_by !== current;
        return (
          <Card key={p.id} style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
              <P style={{ fontWeight: "700", flex: 1 }}>{p.partner_name}</P>
              <P style={{ color: p.status === "active" ? colors.greenBright : colors.textMuted, fontWeight: "700" }}>{statusText(p.status)}</P>
            </View>
            {p.note ? <P muted>{p.note}</P> : null}
            {p.status === "pending" && !invited && <P muted>{lang === "el" ? "Αναμένεται απάντηση" : "Waiting for their answer"}</P>}
            {invited && (
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title={t.accept} busy={busy === `a${p.id}`} onPress={() => act(`a${p.id}`, `/v1/member/partnerships/${p.id}/confirm`)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button kind="secondary" title={t.decline} busy={busy === `d${p.id}`} onPress={() => act(`d${p.id}`, `/v1/member/partnerships/${p.id}/decline`)} />
                </View>
              </View>
            )}
          </Card>
        );
      })}

      <H2>{t.suggestions}</H2>
      <State loading={matches.loading && !matches.data} error={matches.error} onRetry={matches.reload} empty={!matches.loading && !matches.data?.matches.length && (lang === "el" ? "Δεν υπάρχουν προτάσεις ακόμα." : "No suggestions yet.")} />
      {matches.data?.matches
        .filter((m) => !partnerIds.has(m.member_id))
        .map((m) => (
          <Card key={m.member_id} style={{ gap: space.sm }}>
            <P style={{ fontWeight: "700" }}>{m.name}</P>
            <P muted>{m.reasons.map((r) => (lang === "el" ? reasonEl(r) : r)).join(" · ")}</P>
            <Button
              kind="secondary"
              title={t.request}
              busy={busy === `r${m.member_id}`}
              onPress={() => act(`r${m.member_id}`, "/v1/member/partnerships", { member_id: current, partner_id: m.member_id })}
            />
          </Card>
        ))}
    </ScrollView>
  );
}
