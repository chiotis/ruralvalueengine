import type { ColorValue } from "react-native";
import { Tabs } from "expo-router/js-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useI18n } from "../../lib/i18n";
import { colors } from "../../lib/theme";

type IconName = keyof typeof Ionicons.glyphMap;
const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue | null; size: number }) => <Ionicons name={name} color={(color ?? undefined) as string | undefined} size={size} />;

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.greenBright,
        tabBarInactiveTintColor: colors.textMuted,
        headerStyle: { backgroundColor: colors.greenDark },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t.explore, tabBarIcon: icon("compass-outline") }} />
      <Tabs.Screen name="map" options={{ title: t.map, tabBarIcon: icon("map-outline") }} />
      <Tabs.Screen name="passport" options={{ title: t.passport, tabBarIcon: icon("ribbon-outline") }} />
      <Tabs.Screen name="wallet" options={{ title: t.wallet, tabBarIcon: icon("wallet-outline") }} />
      <Tabs.Screen name="profile" options={{ title: t.profile, tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}
