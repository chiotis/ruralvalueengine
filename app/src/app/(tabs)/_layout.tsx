import type { ColorValue } from "react-native";
import { Tabs } from "expo-router/js-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useI18n } from "../../lib/i18n";
import { colors } from "../../lib/theme";
import { AppHeader } from "../../components/AppHeader";

type IconName = keyof typeof Ionicons.glyphMap;
const icon =
  (off: IconName, on: IconName) =>
  ({ color, size, focused }: { color: ColorValue | null; size: number; focused: boolean }) => (
    <Ionicons name={focused ? on : off} color={(color ?? undefined) as string | undefined} size={size} />
  );

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarLabelStyle: { fontWeight: "700", fontSize: 11 },
        header: ({ options }) => <AppHeader title={options.title ?? route.name} />,
        sceneStyle: { backgroundColor: colors.background },
      })}
    >
      <Tabs.Screen name="index" options={{ title: t.explore, tabBarIcon: icon("compass-outline", "compass") }} />
      <Tabs.Screen name="map" options={{ title: t.map, tabBarIcon: icon("map-outline", "map") }} />
      <Tabs.Screen name="passport" options={{ title: t.passport, tabBarIcon: icon("book-outline", "book") }} />
      <Tabs.Screen name="wallet" options={{ title: t.wallet, tabBarIcon: icon("wallet-outline", "wallet") }} />
      <Tabs.Screen name="profile" options={{ title: t.profile, tabBarIcon: icon("person-circle-outline", "person-circle") }} />
    </Tabs>
  );
}
