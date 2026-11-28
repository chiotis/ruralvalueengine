import { useState } from "react";
import { ScrollView, Share, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { useMember } from "../../lib/member";
import { useApi } from "../../lib/useApi";
import { api } from "../../lib/api";
import { MemberPicker } from "../../components/MemberPicker";
import { Button, Card, H2, P, State } from "../../components/ui";
import { colors, space, inter } from "../../lib/theme";

interface Referral {
  id: string;
  code: string;
  from_member_id: string;
  to_member_id: string;
  expires_at: string;
  created_at: string;
  redeemed: number;
  from_name: string | null;
  to_name: string | null;
}

export default function MemberReferrals() {
  const { t, lang } = useI18n();
  const { q, current } = useMember();
  const list = useApi<{ referrals: Referral[] }>(current ? q("/v1/member/referrals") : null, "member");
  const [to, setTo] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ code: string; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    if (!to || !current) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ code: string }>("/v1/member/referrals", { method: "POST", role: "member", body: { member_id: current, to_member_id: to.id } });
      setMade({ code: r.code, name: to.name });
      setTo(null);
      void list.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = (code: string, name: string) =>
    Share.share({
      message:
        lang === "el"
          ? `Σας προτείνω να επισκεφθείτε: ${name}. Δείξτε τον κωδικό ${code} στην εφαρμογή Rural Greece όταν σαρώσετε το QR τους.`
          : `I recommend visiting ${name}. Enter code ${code} in the Rural Greece app when you scan their QR.`,
    });

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <P muted>
        {lang === "el"
          ? "Στείλτε τους επισκέπτες σας σε άλλο μέλος. Όταν χρησιμοποιήσουν τον κωδικό στη σάρωση εκεί, κερδίζετε +10 πόντους."
          : "Send your visitors to another member. When they use the code while scanning there, you earn +10 points."}
      </P>
      <H2>{t.newReferral}</H2>
      {to ? (
        <Card style={{ gap: space.sm }}>
          <P style={{ fontWeight: "700" }}>{to.name}</P>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title={t.create} onPress={create} busy={busy} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="secondary" title={lang === "el" ? "Αλλαγή" : "Change"} onPress={() => setTo(null)} />
            </View>
          </View>
        </Card>
      ) : (
        <MemberPicker exclude={current} onPick={setTo} />
      )}
      {err && <P style={{ color: colors.burgundy }}>{err}</P>}
      {made && (
        <Card style={{ backgroundColor: colors.sky, gap: space.sm }}>
          <P>{lang === "el" ? `Κωδικός για ${made.name}` : `Code for ${made.name}`}</P>
          <P style={{ fontFamily: inter, fontSize: 28, fontWeight: "800", letterSpacing: 3, textAlign: "center", color: colors.greenDark }}>{made.code}</P>
          <Button kind="secondary" title={lang === "el" ? "Κοινοποίηση" : "Share"} onPress={() => share(made.code, made.name)} />
        </Card>
      )}

      <H2>{t.referrals}</H2>
      <State loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!list.loading && !list.data?.referrals.length && (lang === "el" ? "Καμία σύσταση ακόμα." : "No referrals yet.")} />
      {list.data?.referrals.map((r) => {
        const sent = r.from_member_id === current;
        const expired = new Date(r.expires_at).getTime() < Date.now();
        return (
          <Card key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <P style={{ fontWeight: "700", letterSpacing: 1 }}>{r.code}</P>
              <P muted>
                {sent ? (lang === "el" ? "Προς " : "To ") + (r.to_name ?? r.to_member_id) : (lang === "el" ? "Από " : "From ") + (r.from_name ?? r.from_member_id)}
                {expired ? (lang === "el" ? " · έληξε" : " · expired") : ""}
              </P>
            </View>
            <P style={{ fontWeight: "800", color: colors.greenOnSoft }}>{r.redeemed}×</P>
          </Card>
        );
      })}
    </ScrollView>
  );
}
