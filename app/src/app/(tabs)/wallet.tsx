import { useCallback, useState } from "react";
import { FlatList, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { useApi } from "../../lib/useApi";
import { api, ApiError } from "../../lib/api";
import { Button, Card, H1, H2, P, State } from "../../components/ui";
import { colors, space } from "../../lib/theme";

interface Wallet {
  balance: number;
  entries: { id: string; points: number; rule_id: string; event_type: string; created_at: string }[];
}
interface Reward {
  id: string;
  member_name: string | null;
  title: string;
  cost: number;
}

const RULE_LABEL: Record<string, [string, string]> = {
  "checkin.member.visitor": ["Επίσκεψη σε επιχείρηση", "Visit to a business"],
  "checkin.poi.qr": ["Επίσκεψη σε σημείο", "Visit to a place"],
  "checkin.poi.geo": ["Επίσκεψη σε σημείο (GPS)", "Visit to a place (GPS)"],
  "route.completed.visitor": ["Ολοκλήρωση διαδρομής", "Route completed"],
  "referral.visitor": ["Σύσταση", "Referral"],
  "reward.redeem": ["Εξαργύρωση", "Redemption"],
};
const label = (rule: string, lang: "el" | "en") => {
  const base = rule.replace(/^reverse:/, "");
  const l = RULE_LABEL[base]?.[lang === "el" ? 0 : 1] ?? base;
  return rule.startsWith("reverse:") ? `${lang === "el" ? "Ακύρωση" : "Reversal"}: ${l}` : l;
};

export default function WalletTab() {
  const { t, lang } = useI18n();
  const session = useSession();
  const router = useRouter();
  const w = useApi<Wallet>(session.visitor ? "/v1/me/wallet" : null, "visitor");
  const rewards = useApi<{ rewards: Reward[] }>(`/v1/rewards?lang=${lang}`);
  const [code, setCode] = useState<{ code: string; title: string; until: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      // Rewards change in the admin panel and member area, so re-read them each time the tab opens.
      void rewards.reload();
      if (session.visitor) void w.reload();
    }, [session.visitor, w.reload, rewards.reload]),
  );

  if (!session.visitor) {
    return (
      <View style={{ padding: space.lg }}>
        <Card>
          <H2>{t.wallet}</H2>
          <P muted>{t.loginHelp}</P>
          <Button title={t.verify} onPress={() => router.push("/login")} />
        </Card>
      </View>
    );
  }

  const redeem = async (r: Reward) => {
    setErr(null);
    try {
      const res = await api<{ code: string; expires_in: number }>("/v1/me/redemptions", { body: { reward_id: r.id }, role: "visitor" });
      setCode({ code: res.code, title: r.title, until: Date.now() + res.expires_in * 1000 });
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "not_enough_points" ? (lang === "el" ? "Δεν έχετε αρκετούς πόντους." : "Not enough points.") : t.error);
    }
  };

  const balance = w.data?.balance ?? 0;
  return (
    <FlatList
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={w.data?.entries ?? []}
      keyExtractor={(e) => String(e.id)}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          <Card style={{ backgroundColor: colors.greenDark }}>
            <P style={{ color: colors.sky }}>{t.balance}</P>
            <H1>
              <P style={{ color: "#fff", fontSize: 40, fontWeight: "800" }}>{`${balance} `}</P>
              <P style={{ color: "#fff" }}>{t.points}</P>
            </H1>
          </Card>
          {code && Date.now() < code.until && (
            <Card style={{ borderColor: colors.greenBright, borderWidth: 2, alignItems: "center" }}>
              <P muted>{t.showCode}</P>
              <P style={{ fontSize: 44, fontWeight: "800", letterSpacing: 6, color: colors.greenDark }}>{code.code}</P>
              <P>{code.title}</P>
              <P muted>{`${t.expiresIn} 15′`}</P>
            </Card>
          )}
          {err && <P style={{ color: colors.burgundy }}>{err}</P>}
          {!!rewards.data?.rewards.length && <H2>{t.rewards}</H2>}
          {rewards.data?.rewards.map((r) => (
            <Card key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, gap: 2 }}>
                <P style={{ fontWeight: "700" }}>{r.title}</P>
                <P muted>{`${r.member_name ?? "Rural Greece"} · ${r.cost} ${t.points}`}</P>
              </View>
              <Button kind={balance >= r.cost ? "primary" : "secondary"} disabled={balance < r.cost} title={t.redeem} onPress={() => redeem(r)} />
            </Card>
          ))}
          <H2>{t.history}</H2>
          <State loading={w.loading && !w.data} error={w.error} onRetry={w.reload} empty={!w.loading && !w.data?.entries.length && (lang === "el" ? "Δεν υπάρχουν κινήσεις ακόμα." : "No activity yet.")} />
        </View>
      }
      renderItem={({ item }) => (
        <Card style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <P>{label(item.rule_id, lang)}</P>
            <P muted>{new Date(item.created_at).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB")}</P>
          </View>
          <P style={{ fontWeight: "800", color: item.points >= 0 ? colors.greenBright : colors.burgundy }}>{`${item.points > 0 ? "+" : ""}${item.points}`}</P>
        </Card>
      )}
      onRefresh={() => {
        void rewards.reload();
        void w.reload();
      }}
      refreshing={false}
    />
  );
}
