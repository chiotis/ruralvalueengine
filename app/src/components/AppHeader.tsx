import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { colors, radius, serif, space } from "../lib/theme";

/** The visitor's points, refreshed whenever the screen changes (after a scan, a redemption, …). */
export function useBalance() {
  const session = useSession();
  const pathname = usePathname();
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!session.visitor) return setBalance(null);
    let live = true;
    api<{ balance: number }>("/v1/me/wallet", { role: "visitor" })
      .then((w) => live && setBalance(w.balance))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [session.visitor, pathname]);
  return balance;
}

export function PointsPill() {
  const { t } = useI18n();
  const router = useRouter();
  const balance = useBalance();
  if (balance == null) return null;
  return (
    <Pressable onPress={() => router.navigate("/wallet")} accessibilityRole="button" style={styles.pill}>
      <Ionicons name="leaf" size={14} color={colors.green} />
      <Text style={styles.pillText}>{`${balance.toLocaleString("el-GR")} ${t.points}`}</Text>
    </Pressable>
  );
}

/** Light header for the tabs: brand on the left, the visitor's points on the right. */
export function AppHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.mark}>
        <Ionicons name="leaf" size={18} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.brand} numberOfLines={1}>
          Rural Greece
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <PointsPill />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mark: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  brand: { fontFamily: serif, fontSize: 18, lineHeight: 24, fontWeight: "700", color: colors.greenDark },
  sub: { fontSize: 12, lineHeight: 16, color: colors.textMuted, fontWeight: "600" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.greenSoft, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 12 },
  pillText: { fontSize: 13, lineHeight: 17, fontWeight: "800", color: colors.green },
});
