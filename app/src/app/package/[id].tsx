import { useCallback } from "react";
import { ScrollView, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { useApi } from "../../lib/useApi";
import { Button, Card, H1, P, State } from "../../components/ui";
import { colors, space } from "../../lib/theme";

interface Pkg {
  id: string;
  title: string;
  description: string | null;
  stops: { target_id: string; name: string | null }[];
}
interface Progress {
  stops: { target_id: string; done_at: string | null }[];
  done: number;
  total: number;
  completed_at: string | null;
}

export default function PackageDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useI18n();
  const session = useSession();
  const router = useRouter();
  const list = useApi<{ packages: Pkg[] }>(`/v1/packages?lang=${lang}`);
  const progress = useApi<Progress>(session.visitor ? `/v1/me/progress/${id}` : null, "visitor");
  useFocusEffect(
    useCallback(() => {
      if (session.visitor) void progress.reload();
    }, [session.visitor, progress.reload]),
  );
  const pkg = list.data?.packages.find((p) => p.id === id);
  if (!pkg) return <State loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.loading && t.error} />;
  const done = new Set(progress.data?.stops.filter((s) => s.done_at).map((s) => s.target_id));

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Stack.Screen options={{ title: pkg.title }} />
      <H1>{pkg.title}</H1>
      {pkg.description ? <P>{pkg.description}</P> : null}
      {progress.data && (
        <Card style={{ backgroundColor: progress.data.completed_at ? colors.greenBright : colors.surface }}>
          <P style={{ fontWeight: "700", color: progress.data.completed_at ? "#fff" : colors.text }}>
            {progress.data.completed_at ? `🏅 ${t.completed}` : `${t.progress}: ${progress.data.done}/${progress.data.total}`}
          </P>
        </Card>
      )}
      {pkg.stops.map((s, i) => (
        <Card key={s.target_id} onPress={() => router.push(`/item/${s.target_id}`)} style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: done.has(s.target_id) ? colors.greenBright : colors.sky }}>
            <P style={{ color: done.has(s.target_id) ? "#fff" : colors.greenDark, fontWeight: "800" }}>{done.has(s.target_id) ? "✓" : String(i + 1)}</P>
          </View>
          <P style={{ flex: 1, fontWeight: "600" }}>{s.name ?? s.target_id}</P>
        </Card>
      ))}
      {!session.visitor && <Button title={t.verify} onPress={() => router.push("/login")} />}
      <P muted>{lang === "el" ? "Σαρώστε τον κωδικό QR σε κάθε στάση. Με την ολοκλήρωση κερδίζετε +30 πόντους." : "Scan the QR code at each stop. Completing it earns +30 points."}</P>
    </ScrollView>
  );
}
