import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { api, ApiError, saveTokens } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Button, Field, H2, P } from "./ui";
import { colors, space } from "../lib/theme";

/** Passwordless sign-in: email → 6-digit code → signed in. Used by visitors and members. */
export function EmailLogin({ role, onDone }: { role: "visitor" | "member"; onDone: () => void }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = role === "visitor" ? "/v1/auth/email" : "/v1/member/auth/email";

  const send = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api(`${base}/start`, { body: { email: email.trim() } });
      setStep("code");
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "too_many_codes" ? (lang === "el" ? "Πολλές προσπάθειες. Δοκιμάστε σε λίγο." : "Too many attempts. Try again later.") : t.error);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setErr(null);
    setBusy(true);
    try {
      const tokens = await api<{ access_token: string; refresh_token: string }>(`${base}/verify`, { body: { email: email.trim(), code: code.trim() } });
      await saveTokens(role, tokens);
      await session.reload();
      onDone();
    } catch (e) {
      const c = e instanceof ApiError ? e.code : "";
      setErr(
        c === "code_invalid"
          ? lang === "el" ? "Λάθος κωδικός." : "Wrong code."
          : c === "code_expired"
            ? lang === "el" ? "Ο κωδικός έληξε. Ζητήστε νέο." : "The code expired. Ask for a new one."
            : t.error,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <H2>{role === "visitor" ? t.loginTitle : t.memberLogin}</H2>
        <P muted>
          {role === "visitor"
            ? t.loginHelp
            : lang === "el"
              ? "Χρησιμοποιήστε το email της επιχείρησής σας όπως εμφανίζεται στο ruralgreece.gr."
              : "Use your business email as listed on ruralgreece.gr."}
        </P>
        {step === "email" ? (
          <>
            <Field label={t.email} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} />
            <Button title={t.sendCode} onPress={send} busy={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} />
          </>
        ) : (
          <>
            <P>{email.trim()}</P>
            <Field label={t.code} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />
            <Button title={t.verify} onPress={verify} busy={busy} disabled={code.length !== 6} />
            <Button kind="secondary" title={lang === "el" ? "Άλλο email" : "Different email"} onPress={() => setStep("email")} />
          </>
        )}
        {err && <P style={{ color: colors.burgundy }}>{err}</P>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
