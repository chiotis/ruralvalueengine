import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CatalogSummary } from "../lib/api";
import { pointsLabel } from "../lib/points";
import { colors, font, serif, space, inter } from "../lib/theme";
import { Card, Eyebrow, Pill, Thumb, type IconName } from "./ui";

export const KIND_LABEL = { business: { el: "Επιχείρηση", en: "Business" }, route: { el: "Διαδρομή", en: "Route" }, poi: { el: "Σημείο", en: "Place" } };
export const KIND_ICON: Record<CatalogSummary["kind"], IconName> = { business: "storefront-outline", route: "trail-sign-outline", poi: "location-outline" };
export const KIND_COLOR = { business: colors.burgundy, route: colors.greenBright, poi: colors.brown } as const;

export function ItemCard({ item, lang }: { item: CatalogSummary; lang: "el" | "en" }) {
  const router = useRouter();
  const thumb = item.image?.sizes?.medium?.url ?? item.image?.url;
  const pts = pointsLabel(item.kind);
  return (
    <Card onPress={() => router.push(`/item/${item.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
      <Thumb uri={thumb} size={84} icon={KIND_ICON[item.kind]} />
      <View style={{ flex: 1, gap: 4 }}>
        <Eyebrow color={KIND_COLOR[item.kind]}>{KIND_LABEL[item.kind][lang]}</Eyebrow>
        <Text style={{ fontFamily: serif, fontSize: 16, lineHeight: 21, fontWeight: "700", color: colors.greenDark }} numberOfLines={2}>
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text style={{ fontFamily: inter, fontSize: font.small, color: colors.textMuted }} numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
        {(pts || item.distance_km != null) && (
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", marginTop: 2 }}>
            {pts ? <Pill icon="leaf" label={`${pts} ${lang === "el" ? "πόντοι" : "pts"}`} /> : null}
            {item.distance_km != null ? <Pill tone="sand" icon="navigate-outline" label={`${item.distance_km} km`} /> : null}
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Card>
  );
}
