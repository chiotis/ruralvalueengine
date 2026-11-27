import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { useI18n } from "../../lib/i18n";
import { useApi } from "../../lib/useApi";
import type { CatalogSummary } from "../../lib/api";
import { LeafletMap, type MapMarker } from "../../components/LeafletMap";
import { Chip, State } from "../../components/ui";
import { space } from "../../lib/theme";

export default function MapTab() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [show, setShow] = useState({ routes: true, businesses: true, pois: false });
  const [me, setMe] = useState<[number, number] | null>(null);
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

  const markers = useMemo<MapMarker[]>(() => {
    const all = [
      ...(show.routes ? (routes.data?.items ?? []) : []),
      ...(show.businesses ? (biz.data?.items ?? []) : []),
      ...(show.pois ? (pois.data?.items ?? []) : []),
    ];
    return all
      .filter((i) => i.lat != null && i.lng != null)
      .map((i) => ({ id: i.id, lat: i.lat as number, lng: i.lng as number, kind: i.kind, title: i.title }));
  }, [show, routes.data, biz.data, pois.data]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", gap: space.sm, padding: space.md, flexWrap: "wrap" }}>
        <Chip label={t.routes} active={show.routes} onPress={() => setShow({ ...show, routes: !show.routes })} />
        <Chip label={t.businesses} active={show.businesses} onPress={() => setShow({ ...show, businesses: !show.businesses })} />
        <Chip label={t.pois} active={show.pois} onPress={() => setShow({ ...show, pois: !show.pois })} />
      </View>
      {routes.loading && biz.loading ? (
        <State loading />
      ) : (
        <LeafletMap markers={markers} me={me} onSelect={(id) => router.push(`/item/${id}`)} />
      )}
    </View>
  );
}
