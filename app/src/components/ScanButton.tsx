import { Pressable, StyleSheet } from "react-native";
import { usePathname, useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useI18n } from "../lib/i18n";
import { colors } from "../lib/theme";

const TAB_BAR = 49;
const HIDDEN = ["/scan", "/login"];

/**
 * Always-there scan button, bottom right. Visitors use it to check in at a place;
 * businesses use the same scanner to confirm a visitor's redemption QR.
 */
export function ScanButton() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  if (HIDDEN.includes(pathname)) return null;
  const overTabs = segments[0] === "(tabs)";
  return (
    <Pressable
      onPress={() => router.push("/scan")}
      accessibilityRole="button"
      accessibilityLabel={t.scan}
      style={({ pressed }) => [styles.fab, { bottom: insets.bottom + (overTabs ? TAB_BAR : 0) + 16 }, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name="qr-code-outline" size={28} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.greenBright,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
