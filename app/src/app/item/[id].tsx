import { useEffect, useState } from "react";
import { Image, Linking, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { useApi } from "../../lib/useApi";
import type { CatalogItem } from "../../lib/api";
import { kmlToLatLngs } from "../../lib/kml";
import { htmlToParagraphs } from "../../lib/html";
import { LeafletMap } from "../../components/LeafletMap";
import { GeoCheckin } from "../../components/GeoCheckin";
import { ItemCard } from "../../components/ItemCard";
import { Button, Card, H1, H2, P, State, Stat } from "../../components/ui";
import { colors, space } from "../../lib/theme";

export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useI18n();
  const session = useSession();
  const item = useApi<CatalogItem>(`/v1/catalog/item/${id}?lang=${lang}`);
  const score = useApi<{ score: number; inputs: Record<string, number> }>(id?.startsWith("biz-") ? `/v1/members/${id}/score` : null);
  const [track, setTrack] = useState<[number, number][][]>([]);

  useEffect(() => {
    const url = item.data?.map_kml;
    if (!url) return;
    fetch(url)
      .then((r) => r.text())
      .then((k) => setTrack(kmlToLatLngs(k)))
      .catch(() => setTrack([]));
  }, [item.data?.map_kml]);

  const d = item.data;
  if (!d) return <State loading={item.loading} error={item.error} onRetry={item.reload} />;

  const hero = d.gallery[0]?.url ?? d.image?.url;
  const facts: [string, string | null | undefined][] = [
    [t.duration, d.duration],
    [t.length, d.trail_length],
    [lang === "el" ? "Προτεινόμενη περίοδος" : "Best season", d.season],
    [lang === "el" ? "Ωράριο" : "Opening hours", d.opening_hours],
  ];
  const open = (url: string) => void Linking.openURL(url);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
      <Stack.Screen options={{ title: d.title }} />
      {hero ? <Image source={{ uri: hero }} style={{ width: "100%", height: 220, backgroundColor: colors.border }} /> : null}
      <View style={{ padding: space.lg, gap: space.md }}>
        <H1>{d.title}</H1>
        {d.subtitle ? <P muted>{d.subtitle}</P> : null}

        {score.data && (
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Stat label={t.impactScore} value={score.data.score} />
          </View>
        )}

        {facts.some(([, v]) => v) && (
          <Card>
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <P key={k}>
                <P style={{ fontWeight: "700" }}>{`${k}: `}</P>
                {v}
              </P>
            ))}
          </Card>
        )}

        {d.kind === "poi" && d.lat != null && d.lng != null && session.visitor && <GeoCheckin poiId={d.id} lat={d.lat} lng={d.lng} />}

        {[...htmlToParagraphs(d.intro), ...htmlToParagraphs(d.body)].map((p, i) => (
          <P key={i}>{p}</P>
        ))}

        {d.lat != null && d.lng != null && (
          <LeafletMap
            height={260}
            markers={[{ id: d.id, lat: d.lat, lng: d.lng, kind: d.kind, title: d.title }, ...d.nearby.filter((n) => n.lat != null).map((n) => ({ id: n.id, lat: n.lat as number, lng: n.lng as number, kind: n.kind, title: n.title }))]}
            lines={track}
          />
        )}

        {(d.contact.telephone || d.contact.website_url || d.contact.email || d.contact.address) && (
          <Card>
            <H2>{t.contact}</H2>
            {d.contact.address ? <P muted>{d.contact.address}</P> : null}
            {d.contact.telephone ? <Button kind="secondary" title={`${t.call} ${d.contact.telephone}`} onPress={() => open(`tel:${d.contact.telephone!.replace(/\s/g, "")}`)} /> : null}
            {d.contact.website_url ? <Button kind="secondary" title={t.website} onPress={() => open(d.contact.website_url!)} /> : null}
            {d.contact.email ? <Button kind="secondary" title={d.contact.email} onPress={() => open(`mailto:${d.contact.email}`)} /> : null}
            {d.contact.booking_url ? <Button kind="secondary" title={t.bookExternal} onPress={() => open(d.contact.booking_url!)} /> : null}
          </Card>
        )}
        {d.lat != null && d.lng != null && (
          <Button title={t.directions} onPress={() => open(`https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`)} />
        )}

        {d.nearby.length > 0 && (
          <View style={{ gap: space.md }}>
            <H2>{t.nearby}</H2>
            {d.nearby.slice(0, 12).map((n) => (
              <ItemCard key={n.id} item={n} lang={lang} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
