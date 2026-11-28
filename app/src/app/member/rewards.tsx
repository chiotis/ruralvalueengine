import { useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { useMember } from "../../lib/member";
import { useApi } from "../../lib/useApi";
import { api, ApiError } from "../../lib/api";
import { ulid } from "../../lib/ulid";
import { Button, Card, Field, H2, P, State } from "../../components/ui";
import { colors, space } from "../../lib/theme";

interface Reward {
  id: string;
  title_el: string;
  title_en: string | null;
  cost: number;
  active: boolean;
}

const CONFIRM_ERRORS: Record<string, [string, string]> = {
  unknown_code: ["Ο κωδικός δεν βρέθηκε ή έχει ήδη χρησιμοποιηθεί.", "Code not found or already used."],
  code_expired: ["Ο κωδικός έληξε. Ο επισκέπτης μπορεί να ζητήσει νέο.", "The code has expired. The visitor can ask for a new one."],
  reward_belongs_to_another_member: ["Η ανταμοιβή ανήκει σε άλλο μέλος.", "This reward belongs to another member."],
  not_enough_points: ["Ο επισκέπτης δεν έχει πλέον αρκετούς πόντους.", "The visitor no longer has enough points."],
};

export default function MemberRewards() {
  const { t, lang } = useI18n();
  const { q, current } = useMember();
  const router = useRouter();
  const rewards = useApi<{ rewards: Reward[] }>(current ? q("/v1/member/rewards") : null, "member");

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [titleEl, setTitleEl] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ reward: string; cost: number }>("/v1/member/redemptions/confirm", { method: "POST", role: "member", body: { member_id: current, code } });
      setResult({ ok: true, text: lang === "el" ? `Επιβεβαιώθηκε: ${r.reward} (−${r.cost} πόντοι)` : `Confirmed: ${r.reward} (−${r.cost} points)` });
      setCode("");
    } catch (e) {
      const c = e instanceof ApiError ? e.code : "";
      const msg = CONFIRM_ERRORS[c];
      setResult({ ok: false, text: msg ? msg[lang === "el" ? 0 : 1] : t.error });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const n = Number(cost);
    if (!titleEl.trim() || !Number.isInteger(n) || n < 1) {
      setSaveErr(lang === "el" ? "Συμπληρώστε τίτλο και πόντους (ακέραιος ≥ 1)." : "Enter a title and a whole number of points (1 or more).");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      await api(`/v1/member/rewards/rwd-${ulid().toLowerCase()}`, {
        method: "PUT",
        role: "member",
        body: { member_id: current, title_el: titleEl.trim(), title_en: titleEn.trim() || undefined, cost: n, active: true },
      });
      setTitleEl("");
      setTitleEn("");
      setCost("");
      void rewards.reload();
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (r: Reward, active: boolean) => {
    await api(`/v1/member/rewards/${r.id}`, {
      method: "PUT",
      role: "member",
      body: { member_id: current, title_el: r.title_el, title_en: r.title_en ?? undefined, cost: r.cost, active },
    }).catch(() => {});
    void rewards.reload();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <H2>{t.confirmRedemption}</H2>
      <P muted>
        {lang === "el"
          ? "Σαρώστε τον κωδικό QR στο κινητό του επισκέπτη, ή πληκτρολογήστε τον 6ψήφιο κωδικό από κάτω."
          : "Scan the QR code on the visitor's phone, or type the 6-digit code shown under it."}
      </P>
      <Button title={lang === "el" ? "Σάρωση QR επισκέπτη" : "Scan visitor's QR"} onPress={() => router.push("/scan")} />
      <Field label={lang === "el" ? "Κωδικός" : "Code"} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} />
      <Button title={t.confirm} onPress={confirm} busy={busy} disabled={code.length !== 6} />
      {result && (
        <Card style={{ backgroundColor: result.ok ? colors.greenBright : colors.surface }}>
          <P style={{ color: result.ok ? "#fff" : colors.burgundy, fontWeight: "700" }}>{result.text}</P>
        </Card>
      )}

      <H2>{t.rewards}</H2>
      <State loading={rewards.loading && !rewards.data} error={rewards.error} onRetry={rewards.reload} empty={!rewards.loading && !rewards.data?.rewards.length && (lang === "el" ? "Δεν έχετε ανταμοιβές ακόμα." : "You have no rewards yet.")} />
      {rewards.data?.rewards.map((r) => (
        <Card key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <P style={{ fontWeight: "700" }}>{lang === "en" ? (r.title_en ?? r.title_el) : r.title_el}</P>
            <P muted>
              {r.cost} {t.points}
              {r.active ? "" : lang === "el" ? " · ανενεργή" : " · inactive"}
            </P>
          </View>
          <Button
            kind="secondary"
            title={r.active ? (lang === "el" ? "Απόσυρση" : "Withdraw") : lang === "el" ? "Ενεργοποίηση" : "Activate"}
            onPress={() => setActive(r, !r.active)}
          />
        </Card>
      ))}

      <H2>{lang === "el" ? "Νέα ανταμοιβή" : "New reward"}</H2>
      <Field label={lang === "el" ? "Τίτλος (ελληνικά)" : "Title (Greek)"} value={titleEl} onChangeText={setTitleEl} />
      <Field label={lang === "el" ? "Τίτλος (αγγλικά, προαιρετικό)" : "Title (English, optional)"} value={titleEn} onChangeText={setTitleEn} />
      <Field label={lang === "el" ? "Κόστος σε πόντους" : "Cost in points"} value={cost} onChangeText={(v) => setCost(v.replace(/\D/g, ""))} keyboardType="number-pad" />
      {saveErr && <P style={{ color: colors.burgundy }}>{saveErr}</P>}
      <Button title={t.create} onPress={save} busy={saving} />
    </ScrollView>
  );
}
