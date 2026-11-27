import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import type { CatalogSummary } from "../lib/api";
import { colors, font, space } from "../lib/theme";
import { Card, Thumb } from "./ui";

const KIND_LABEL = { business: { el: "Επιχείρηση", en: "Business" }, route: { el: "Διαδρομή", en: "Route" }, poi: { el: "Σημείο", en: "Place" } };

export function ItemCard({ item, lang }: { item: CatalogSummary; lang: "el" | "en" }) {
  const router = useRouter();
  const thumb = item.image?.sizes?.medium?.url ?? item.image?.url;
  return (
    <Card onPress={() => router.push(`/item/${item.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <Thumb uri={thumb} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: font.small, color: colors.brown, fontWeight: "700" }}>{KIND_LABEL[item.kind][lang]}</Text>
        <Text style={{ fontSize: font.body, fontWeight: "700", color: colors.greenDark }} numberOfLines={2}>
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text style={{ fontSize: font.small, color: colors.textMuted }} numberOfLines={1}>
            {item.subtitle}
          </Text>
        ) : null}
        {item.distance_km != null && <Text style={{ fontSize: font.small, color: colors.green }}>{item.distance_km} km</Text>}
      </View>
    </Card>
  );
}
