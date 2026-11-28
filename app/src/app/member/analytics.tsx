import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { useMember } from "../../lib/member";
import { useApi } from "../../lib/useApi";
import { Card, Chip, H2, P, Stat, State } from "../../components/ui";
import { colors, space } from "../../lib/theme";
import { fillDays } from "../../lib/days";

interface Analytics {
  days: number;
  visits_per_day: { day: string; visits: number }[];
  unique_visitors: number;
  repeat_visitors: number;
  referrals_sent: number;
  referrals_received: number;
  points_earned: number;
  visitors_also_visited: { member_id: string; name: string; shared_visitors: number }[];
}

function Bars({ data }: { data: { day: string; visits: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.visits));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 120, gap: 2 }}>
      {data.map((d) => (
        <View
          key={d.day}
          accessibilityLabel={`${d.day}: ${d.visits}`}
          style={{ flex: 1, height: `${Math.max(2, (d.visits / max) * 100)}%`, backgroundColor: d.visits ? colors.greenBright : colors.border, borderTopLeftRadius: 2, borderTopRightRadius: 2 }}
        />
      ))}
    </View>
  );
}

export default function MemberAnalytics() {
  const { t, lang } = useI18n();
  const { q, current } = useMember();
  const [days, setDays] = useState(30);
  const res = useApi<Analytics>(current ? q(`/v1/member/analytics?days=${days}`) : null, "member");
  const a = res.data;
  const series = a ? fillDays(a.visits_per_day, a.days) : [];
  const total = series.reduce((s, d) => s + d.visits, 0);

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {[7, 30, 90].map((n) => (
          <Chip key={n} label={lang === "el" ? `${n} ημέρες` : `${n} days`} active={days === n} onPress={() => setDays(n)} />
        ))}
      </View>
      <State loading={res.loading && !a} error={res.error} onRetry={res.reload} />
      {a && (
        <>
          <Card style={{ gap: space.sm }}>
            <P style={{ fontWeight: "700" }}>{lang === "el" ? `Επισκέψεις: ${total}` : `Visits: ${total}`}</P>
            <Bars data={series} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <P muted>{series[0]?.day.slice(5)}</P>
              <P muted>{series[series.length - 1]?.day.slice(5)}</P>
            </View>
          </Card>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Stat label={t.uniqueVisitors} value={a.unique_visitors} />
            <Stat label={lang === "el" ? "Επαναλαμβανόμενοι" : "Returning"} value={a.repeat_visitors} />
          </View>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Stat label={lang === "el" ? "Συστάσεις που στείλατε" : "Referrals sent"} value={a.referrals_sent} />
            <Stat label={lang === "el" ? "Συστάσεις που λάβατε" : "Referrals received"} value={a.referrals_received} />
          </View>
          <Stat label={lang === "el" ? "Πόντοι που κερδίσατε" : "Points earned"} value={a.points_earned} />

          <H2>{t.alsoVisited}</H2>
          {a.visitors_also_visited.length ? (
            a.visitors_also_visited.map((o) => (
              <Card key={o.member_id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <P style={{ flex: 1, fontWeight: "600" }}>{o.name}</P>
                <P style={{ color: colors.greenOnSoft, fontWeight: "800" }}>{o.shared_visitors}</P>
              </Card>
            ))
          ) : (
            <P muted>{lang === "el" ? "Δεν υπάρχουν ακόμα αρκετά δεδομένα." : "Not enough data yet."}</P>
          )}
        </>
      )}
    </ScrollView>
  );
}
