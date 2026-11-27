import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { useMember } from "../../lib/member";
import { useApi } from "../../lib/useApi";
import { EmailLogin } from "../../components/EmailLogin";
import { Button, Card, Chip, H2, P, State, Stat } from "../../components/ui";
import { space } from "../../lib/theme";

interface Dashboard {
  points: number;
  impact_score: { score: number; inputs: Record<string, number> };
  last_30_days: { visits: number; unique_visitors: number; referrals_sent: number; referrals_received: number };
  active_partners: number;
}

export default function MemberHome() {
  const { t, lang } = useI18n();
  const session = useSession();
  const router = useRouter();
  const { members, current, setCurrent, q } = useMember();
  const dash = useApi<Dashboard>(session.member && current ? q("/v1/member/dashboard") : null, "member");

  if (!session.member) return <EmailLogin role="member" onDone={() => {}} />;

  const d = dash.data;
  const links: [string, string][] = [
    [t.confirmRedemption, "/member/rewards"],
    [t.myQr, "/member/qr"],
    [t.referrals, "/member/referrals"],
    [t.partners, "/member/partners"],
    [t.analytics, "/member/analytics"],
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      {members.length > 1 && (
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          {members.map((m) => (
            <Chip key={m.id} label={m.name} active={m.id === current} onPress={() => setCurrent(m.id)} />
          ))}
        </View>
      )}
      <H2>{members.find((m) => m.id === current)?.name ?? ""}</H2>
      <State loading={dash.loading && !d} error={dash.error} onRetry={dash.reload} />
      {d && (
        <>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Stat label={t.impactScore} value={d.impact_score.score} />
            <Stat label={t.points} value={d.points} />
          </View>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Stat label={t.visits30} value={d.last_30_days.visits} />
            <Stat label={t.uniqueVisitors} value={d.last_30_days.unique_visitors} />
          </View>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Stat label={lang === "el" ? "Συστάσεις που στείλατε" : "Referrals sent"} value={d.last_30_days.referrals_sent} />
            <Stat label={t.partners} value={d.active_partners} />
          </View>
          <Card>
            <P muted>
              {lang === "el"
                ? `Το Impact Score (0–100) βασίζεται στις τελευταίες 90 ημέρες: ${d.impact_score.inputs.visitors} επισκέπτες, ${d.impact_score.inputs.referrals_sent} συστάσεις, ${d.impact_score.inputs.partnerships} συνεργασίες, ${d.impact_score.inputs.routes_completed} ολοκληρωμένες διαδρομές.`
                : `Impact Score (0–100) uses the last 90 days: ${d.impact_score.inputs.visitors} visitors, ${d.impact_score.inputs.referrals_sent} referrals, ${d.impact_score.inputs.partnerships} partnerships, ${d.impact_score.inputs.routes_completed} completed routes.`}
            </P>
          </Card>
        </>
      )}
      {links.map(([label, href]) => (
        <Button key={href} kind="secondary" title={label} onPress={() => router.push(href as never)} />
      ))}
      <Button kind="danger" title={t.logout} onPress={() => session.signOut("member")} />
    </ScrollView>
  );
}
