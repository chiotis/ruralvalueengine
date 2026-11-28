import { useState } from "react";
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { useApi } from "../../lib/useApi";
import type { CatalogSummary } from "../../lib/api";
import { VISITOR_POINTS } from "../../lib/points";
import { ItemCard, KIND_ICON } from "../../components/ItemCard";
import { Button, Card, Chip, Eyebrow, Field, H1, P, Pill, SectionHeader, State } from "../../components/ui";
import { colors, radius, serif, shadow, space, inter } from "../../lib/theme";

type Kind = "routes" | "businesses" | "pois";

interface Pkg {
  id: string;
  title: string;
  description: string | null;
  stops: unknown[];
}

function greeting(lang: "el" | "en") {
  const h = new Date().getHours();
  if (lang === "el") return h < 12 ? "Καλημέρα!" : "Καλησπέρα!";
  return h < 12 ? "Good morning!" : h < 18 ? "Good afternoon!" : "Good evening!";
}

/** Featured packages and routes, side by side in one carousel. */
function Featured({ lang }: { lang: "el" | "en" }) {
  const router = useRouter();
  const pkgs = useApi<{ packages: Pkg[] }>(`/v1/packages?lang=${lang}`);
  const routes = useApi<{ items: CatalogSummary[] }>(`/v1/catalog/routes?lang=${lang}&limit=40`);
  const withImage = (routes.data?.items ?? []).filter((r) => r.image).slice(0, 8);
  if (!pkgs.data?.packages.length && !withImage.length) return null;
  const el = lang === "el";
  return (
    <View style={{ gap: space.sm }}>
      <SectionHeader title={el ? "Προτεινόμενες εμπειρίες" : "Featured experiences"} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingVertical: space.xs, paddingRight: space.lg }}>
        {(pkgs.data?.packages ?? []).map((p) => (
          <Pressable key={p.id} onPress={() => router.push(`/package/${p.id}`)} style={({ pressed }) => [styles.pkg, pressed && { opacity: 0.9 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Pill tone="solid" icon="sparkles" label={el ? "Πακέτο" : "Package"} />
              <Ionicons name="ribbon-outline" size={22} color={colors.sky} />
            </View>
            <Text style={styles.pkgTitle} numberOfLines={2}>
              {p.title}
            </Text>
            {p.description ? (
              <Text style={styles.pkgText} numberOfLines={2}>
                {p.description}
              </Text>
            ) : null}
            <View style={styles.pkgFoot}>
              <Text style={styles.pkgMeta}>{`${p.stops.length} ${el ? "στάσεις" : "stops"}`}</Text>
              <View style={styles.pkgPts}>
                <Ionicons name="leaf" size={13} color={colors.ink} />
                <Text style={styles.pkgPtsText}>{`+${VISITOR_POINTS.packageCompleted} ${el ? "πόντοι" : "pts"}`}</Text>
              </View>
            </View>
          </Pressable>
        ))}
        {withImage.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/item/${r.id}`)} style={({ pressed }) => [styles.route, pressed && { opacity: 0.9 }]}>
            <Image source={{ uri: r.image?.sizes?.large?.url ?? r.image?.url }} style={StyleSheet.absoluteFill} />
            <View style={styles.shade} />
            <Pill tone="sand" icon={KIND_ICON.route} label={el ? "Διαδρομή" : "Route"} />
            <View style={{ flex: 1 }} />
            <Text style={styles.routeTitle} numberOfLines={2}>
              {r.title}
            </Text>
            {r.subtitle ? (
              <Text style={styles.routeSub} numberOfLines={1}>
                {r.subtitle}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default function Explore() {
  const { t, lang } = useI18n();
  const session = useSession();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("routes");
  const [q, setQ] = useState("");
  const [near, setNear] = useState<string | null>(null);
  const el = lang === "el";

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
  const today = new Intl.DateTimeFormat(el ? "el-GR" : "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <FlatList
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 96 }}
      data={list.data?.items ?? []}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <ItemCard item={item} lang={lang} />}
      ListHeaderComponent={
        <View style={{ gap: space.lg }}>
          <View style={{ gap: space.xs }}>
            <Eyebrow>{today}</Eyebrow>
            <H1>{greeting(lang)}</H1>
            <Text style={styles.tagline}>
              {el ? "Ανακαλύψτε τα χωριά, τις γεύσεις και τα μονοπάτια της υπαίθρου." : "Discover the villages, flavours and trails of rural Greece."}
            </Text>
          </View>

          {session.ready && !session.visitor && (
            <Card style={{ backgroundColor: colors.greenSoft, flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Ionicons name="book" size={28} color={colors.greenOnSoft} />
              <View style={{ flex: 1, gap: space.sm }}>
                <P style={{ fontWeight: "700" }}>{el ? "Συλλέξτε σφραγίδες και πόντους" : "Collect stamps and points"}</P>
                <Button title={t.verify} onPress={() => router.push("/login")} style={{ alignSelf: "flex-start", paddingVertical: 10 }} />
              </View>
            </Card>
          )}

          <Featured lang={lang} />

          <View style={{ gap: space.md }}>
            <SectionHeader title={el ? "Εξερευνήστε" : "Explore"} action={t.map} onAction={() => router.navigate("/map")} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
              <Chip icon={KIND_ICON.route} label={t.routes} active={kind === "routes"} onPress={() => setKind("routes")} />
              <Chip icon={KIND_ICON.business} label={t.businesses} active={kind === "businesses"} onPress={() => setKind("businesses")} />
              <Chip icon={KIND_ICON.poi} label={t.pois} active={kind === "pois"} onPress={() => setKind("pois")} />
              <Chip icon="navigate" label={t.nearby} active={!!near} onPress={toggleNear} />
            </ScrollView>
            <Field label="" icon="search" placeholder={t.search} value={q} onChangeText={setQ} autoCorrect={false} returnKeyType="search" />
          </View>
          <State loading={list.loading} error={list.error} onRetry={list.reload} />
        </View>
      }
      refreshing={false}
      onRefresh={list.reload}
    />
  );
}

const styles = StyleSheet.create({
  tagline: { fontFamily: serif, fontStyle: "italic", fontSize: 15, lineHeight: 22, color: colors.brown },
  pkg: { width: 260, minHeight: 190, borderRadius: radius.lg, padding: space.lg, gap: space.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  pkgTitle: { fontFamily: serif, fontSize: 19, lineHeight: 25, fontWeight: "700", color: "#fff" },
  pkgText: { fontFamily: inter, fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.75)" },
  pkgFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: "auto" },
  pkgMeta: { fontFamily: inter, fontSize: 13, fontWeight: "700", color: colors.sky },
  pkgPts: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.sky, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  pkgPtsText: { fontFamily: inter, fontSize: 12, fontWeight: "800", color: colors.ink },
  route: { width: 260, height: 190, borderRadius: radius.lg, padding: space.md, overflow: "hidden", backgroundColor: colors.green, ...shadow },
  shade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,44,35,0.35)" },
  routeTitle: { fontFamily: serif, fontSize: 18, lineHeight: 23, fontWeight: "700", color: "#fff", textShadowColor: "rgba(0,0,0,0.4)", textShadowRadius: 4 },
  routeSub: { fontFamily: inter, fontSize: 12, color: "rgba(255,255,255,0.85)" },
});
