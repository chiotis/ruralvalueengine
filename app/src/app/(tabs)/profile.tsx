import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { pending } from "../../lib/queue";
import { Button, Card, Chip, H2, P } from "../../components/ui";
import { space } from "../../lib/theme";

export default function Profile() {
  const { t, lang, setLang } = useI18n();
  const session = useSession();
  const router = useRouter();
  const [waiting, setWaiting] = useState(0);
  useFocusEffect(
    useCallback(() => {
      void pending().then((p) => setWaiting(p.length));
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Card>
        <H2>{t.language}</H2>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Chip label="Ελληνικά" active={lang === "el"} onPress={() => setLang("el")} />
          <Chip label="English" active={lang === "en"} onPress={() => setLang("en")} />
        </View>
      </Card>

      <Card>
        <H2>{t.profile}</H2>
        {session.visitor ? (
          <>
            {waiting > 0 && <P muted>{`${t.offlineQueue}: ${waiting}`}</P>}
            <Button kind="secondary" title={t.logout} onPress={() => session.signOut("visitor")} />
          </>
        ) : (
          <>
            <P muted>{t.loginHelp}</P>
            <Button title={t.verify} onPress={() => router.push("/login")} />
          </>
        )}
      </Card>

      <Card>
        <H2>{t.member}</H2>
        <P muted>
          {lang === "el"
            ? "Για επιχειρήσεις του δικτύου epaithros+: QR, συστάσεις, συνεργασίες, ανταμοιβές και στατιστικά."
            : "For epaithros+ network businesses: QR codes, referrals, partnerships, rewards and analytics."}
        </P>
        <Button kind="secondary" title={session.member ? t.dashboard : t.memberLogin} onPress={() => router.push("/member")} />
      </Card>

      <P muted style={{ textAlign: "center" }}>Rural Greece · Rural Value Engine</P>
    </ScrollView>
  );
}
