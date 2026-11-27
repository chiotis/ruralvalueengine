import { Stack } from "expo-router";
import { useI18n } from "../../lib/i18n";
import { MemberProvider } from "../../lib/member";
import { colors } from "../../lib/theme";

export default function MemberLayout() {
  const { t } = useI18n();
  return (
    <MemberProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.green },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: t.member }} />
        <Stack.Screen name="qr" options={{ title: t.myQr }} />
        <Stack.Screen name="referrals" options={{ title: t.referrals }} />
        <Stack.Screen name="partners" options={{ title: t.partners }} />
        <Stack.Screen name="rewards" options={{ title: t.rewards }} />
        <Stack.Screen name="analytics" options={{ title: t.analytics }} />
      </Stack>
    </MemberProvider>
  );
}
