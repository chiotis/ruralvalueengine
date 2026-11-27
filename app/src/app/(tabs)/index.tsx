import { useState } from "react";
import { FlatList, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { useI18n } from "../../lib/i18n";
import { useApi } from "../../lib/useApi";
import type { CatalogSummary } from "../../lib/api";
import { ItemCard } from "../../components/ItemCard";
import { Card, Chip, Field, H2, P, State } from "../../components/ui";
import { space } from "../../lib/theme";

type Kind = "routes" | "businesses" | "pois";
interface Pkg {
  id: string;
  title: string;
  description: string | null;
  stops: unknown[];
}

export default function Explore() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("routes");
  const [q, setQ] = useState("");
  const [near, setNear] = useState<string | null>(null);

  // "Nearby" uses the phone's position only when the visitor asks for it.
  const toggleNear = async () => {
    if (near) return setNear(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setNear(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`);
  };

  const params = new URLSearchParams({ lang, limit: "100" });
  if (q.trim().length >= 2) params.set("q", q.trim());
  if (near) params.set("near", near);
  const list = useApi<{ items: CatalogSummary[] }>(`/v1/catalog/${kind}?${params.toString()}`);
  const pkgs = useApi<{ packages: Pkg[] }>(`/v1/packages?lang=${lang}`);

  return (
    <FlatList
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={list.data?.items ?? []}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <ItemCard item={item} lang={lang} />}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          {!!pkgs.data?.packages.length && (
            <View style={{ gap: space.sm }}>
              <H2>{t.packages}</H2>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
                {pkgs.data.packages.map((p) => (
                  <Card key={p.id} style={{ width: 240 }} onPress={() => router.push(`/package/${p.id}`)}>
                    <P style={{ fontWeight: "700" }}>{p.title}</P>
                    {p.description ? <P muted>{p.description}</P> : null}
                    <P muted>{`${p.stops.length} ${lang === "el" ? "στάσεις" : "stops"}`}</P>
                  </Card>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <Chip label={t.routes} active={kind === "routes"} onPress={() => setKind("routes")} />
            <Chip label={t.businesses} active={kind === "businesses"} onPress={() => setKind("businesses")} />
            <Chip label={t.pois} active={kind === "pois"} onPress={() => setKind("pois")} />
            <Chip label={`📍 ${t.nearby}`} active={!!near} onPress={toggleNear} />
          </View>
          <Field label={t.search} value={q} onChangeText={setQ} autoCorrect={false} returnKeyType="search" />
          <State loading={list.loading} error={list.error} onRetry={list.reload} />
        </View>
      }
      refreshing={false}
      onRefresh={list.reload}
    />
  );
}
