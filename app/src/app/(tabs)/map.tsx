import { useEffect, useMemo, useState } from "react";
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useI18n } from "../../lib/i18n";
import { useApi } from "../../lib/useApi";
import type { CatalogSummary } from "../../lib/api";
import { pointsLabel } from "../../lib/points";
import { metersBetween } from "../../lib/geo";
import { LeafletMap, PIN_COLOR, type MapMarker } from "../../components/LeafletMap";
import { ItemCard, KIND_COLOR, KIND_ICON, KIND_LABEL } from "../../components/ItemCard";
import { Button, Chip, Eyebrow, Pill, State, Thumb } from "../../components/ui";
import { colors, radius, serif, shadow, space, inter } from "../../lib/theme";

type Mode = "map" | "list";

const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

export default function MapTab() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const el = lang === "el";
  const [mode, setMode] = useState<Mode>("map");
  const [show, setShow] = useState({ routes: true, businesses: true, pois: false });
  const [me, setMe] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const routes = useApi<{ items: CatalogSummary[] }>(`/v1/catalog/routes?lang=${lang}&limit=200`);
  const biz = useApi<{ items: CatalogSummary[] }>(`/v1/catalog/businesses?lang=${lang}&limit=200`);
  const pois = useApi<{ items: CatalogSummary[] }>(show.pois ? `/v1/catalog/pois?lang=${lang}&limit=200` : null);

  useEffect(() => {
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") return;
      const pos = await Location.getLastKnownPositionAsync();
      if (pos) setMe([pos.coords.latitude, pos.coords.longitude]);
    })();
  }, []);

  const items = useMemo(() => {
    const all = [
      ...(show.routes ? (routes.data?.items ?? []) : []),
      ...(show.businesses ? (biz.data?.items ?? []) : []),
      ...(show.pois ? (pois.data?.items ?? []) : []),
    ].filter((i) => i.lat != null && i.lng != null);
    const dist = (i: CatalogSummary) => (me ? metersBetween({ lat: me[0], lng: me[1] }, { lat: i.lat as number, lng: i.lng as number }) : null);
    return all.map((i) => ({ item: i, meters: dist(i) })).sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0));
  }, [show, routes.data, biz.data, pois.data, me]);

  const markers = useMemo<MapMarker[]>(
    () => items.map(({ item: i }) => ({ id: i.id, lat: i.lat as number, lng: i.lng as number, kind: i.kind, title: i.title, label: pointsLabel(i.kind) })),
    [items],
  );
  const picked = selected ? items.find((x) => x.item.id === selected) : undefined;

  const toggle = (k: keyof typeof show) => {
    setSelected(null);
    setShow({ ...show, [k]: !show[k] });
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar}>
        <View style={styles.segment}>
          {(["map", "list"] as const).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} accessibilityRole="button" accessibilityState={{ selected: mode === m }} style={[styles.segBtn, mode === m && styles.segOn]}>
              <Ionicons name={m === "map" ? "map" : "list"} size={15} color={mode === m ? "#fff" : colors.greenDark} />
              <Text style={[styles.segText, mode === m && { color: "#fff" }]}>{m === "map" ? t.map : el ? "Λίστα" : "List"}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}>
          <Chip dot={PIN_COLOR.route} label={t.routes} active={show.routes} onPress={() => toggle("routes")} />
          <Chip dot={PIN_COLOR.business} label={t.businesses} active={show.businesses} onPress={() => toggle("businesses")} />
          <Chip dot={PIN_COLOR.poi} label={t.pois} active={show.pois} onPress={() => toggle("pois")} />
        </ScrollView>
      </View>

      {routes.loading && biz.loading ? (
        <State loading />
      ) : mode === "list" ? (
        <FlatList
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 96 }}
          data={items}
          keyExtractor={(x) => x.item.id}
          renderItem={({ item: x }) => <ItemCard item={x.meters != null ? { ...x.item, distance_km: Math.round(x.meters / 100) / 10 } : x.item} lang={lang} />}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <LeafletMap markers={markers} me={me} onSelect={setSelected} onTapMap={() => setSelected(null)} />
          {picked && (
            <View style={styles.sheet}>
              <Pressable onPress={() => setSelected(null)} hitSlop={10} accessibilityLabel={el ? "Κλείσιμο" : "Close"} style={styles.close}>
                <Ionicons name="close" size={18} color={colors.greenDark} />
              </Pressable>
              <View style={{ flexDirection: "row", gap: space.md }}>
                <Thumb uri={picked.item.image?.sizes?.medium?.url ?? picked.item.image?.url} size={76} icon={KIND_ICON[picked.item.kind]} />
                <View style={{ flex: 1, gap: 4, paddingRight: space.xl }}>
                  <Eyebrow color={KIND_COLOR[picked.item.kind]}>{KIND_LABEL[picked.item.kind][lang]}</Eyebrow>
                  <Text style={styles.title} numberOfLines={2}>
                    {picked.item.title}
                  </Text>
                  <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                    {picked.meters != null && <Pill tone="sand" icon="navigate-outline" label={distanceText(picked.meters)} />}
                    {pointsLabel(picked.item.kind) && <Pill icon="leaf" label={`${pointsLabel(picked.item.kind)} ${t.points}`} />}
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button
                  kind="secondary"
                  icon="navigate"
                  title={t.directions}
                  style={{ flex: 1 }}
                  onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${picked.item.lat},${picked.item.lng}`)}
                />
                <Button icon="information-circle-outline" title={el ? "Λεπτομέρειες" : "Details"} style={{ flex: 1 }} onPress={() => router.push(`/item/${picked.item.id}`)} />
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.md, paddingLeft: space.lg },
  segment: { flexDirection: "row", backgroundColor: colors.sand, borderRadius: radius.pill, padding: 3 },
  segBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill },
  segOn: { backgroundColor: colors.green },
  segText: { fontFamily: inter, fontSize: 12, fontWeight: "700", color: colors.greenDark },
  // Leaves room on the right for the floating scan button.
  sheet: { position: "absolute", left: space.md, right: space.md, bottom: 88, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, ...shadow, elevation: 8 },
  close: { position: "absolute", top: space.md, right: space.md, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.sand, alignItems: "center", justifyContent: "center", zIndex: 1 },
  title: { fontFamily: serif, fontSize: 17, lineHeight: 22, fontWeight: "700", color: colors.greenDark },
});
