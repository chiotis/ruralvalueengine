import { useCallback } from "react";
import { FlatList, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { useApi } from "../../lib/useApi";
import { Button, Card, H2, P, State, Stat } from "../../components/ui";
import { colors, space } from "../../lib/theme";

interface Entry {
  kind: "checkin" | "route";
  target_id: string;
  event_id: string;
  occurred_at: string;
}

/** Engine ids: member and POI QR targets use the catalogue id; packages and routes use theirs. */
const detailPath = (e: Entry) => (e.kind === "route" && e.target_id.startsWith("pkg-") ? `/package/${e.target_id}` : `/item/${e.target_id}`);

export default function Passport() {
  const { t, lang } = useI18n();
  const session = useSession();
  const router = useRouter();
  const res = useApi<{ entries: Entry[] }>(session.visitor ? "/v1/me/passport" : null, "visitor");
  const names = useApi<{ items: { id: string; title: string }[] }>(`/v1/catalog/businesses?lang=${lang}&limit=200`);
  const pois = useApi<{ items: { id: string; title: string }[] }>(`/v1/catalog/pois?lang=${lang}&limit=200`);
  const routes = useApi<{ items: { id: string; title: string }[] }>(`/v1/catalog/routes?lang=${lang}&limit=200`);
  useFocusEffect(
    useCallback(() => {
      if (session.visitor) void res.reload();
    }, [session.visitor, res.reload]),
  );

  if (!session.visitor) {
    return (
      <View style={{ padding: space.lg }}>
        <Card>
          <H2>{t.passport}</H2>
          <P muted>{t.loginHelp}</P>
          <Button title={t.verify} onPress={() => router.push("/login")} />
        </Card>
      </View>
    );
  }

  const title = new Map([...(names.data?.items ?? []), ...(pois.data?.items ?? []), ...(routes.data?.items ?? [])].map((i) => [i.id, i.title]));
  const entries = res.data?.entries ?? [];
  const places = new Set(entries.filter((e) => e.kind === "checkin").map((e) => e.target_id)).size;
  const done = entries.filter((e) => e.kind === "route").length;
  const fmt = new Intl.DateTimeFormat(lang === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <FlatList
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={entries}
      keyExtractor={(e) => e.event_id}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Stat icon="location" label={lang === "el" ? "Μέρη" : "Places"} value={places} />
            <Stat icon="trail-sign" label={lang === "el" ? "Διαδρομές" : "Routes"} value={done} />
          </View>
          <State loading={res.loading && !res.data} error={res.error} onRetry={res.reload} empty={!res.loading && entries.length === 0 && t.noPassport} />
        </View>
      }
      renderItem={({ item }) => (
        <Card onPress={() => router.push(detailPath(item))} style={{ borderLeftWidth: 4, borderLeftColor: item.kind === "route" ? colors.greenBright : colors.brown }}>
          <P style={{ fontWeight: "700" }}>{`${item.kind === "route" ? "🏅 " : "✓ "}${title.get(item.target_id) ?? item.target_id}`}</P>
          <P muted>{fmt.format(new Date(item.occurred_at))}</P>
        </Card>
      )}
      onRefresh={res.reload}
      refreshing={false}
    />
  );
}
