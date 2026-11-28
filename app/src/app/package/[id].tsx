import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { useApi } from "../../lib/useApi";
import { kindOfId, pointsLabel, VISITOR_POINTS } from "../../lib/points";
import { Button, Card, Eyebrow, H1, H2, P, Pill, Progress, State } from "../../components/ui";
import { colors, serif, space } from "../../lib/theme";

interface Pkg {
  id: string;
  title: string;
  description: string | null;
  stops: { target_id: string; name: string | null }[];
}
interface Progress {
  stops: { target_id: string; done_at: string | null }[];
  done: number;
  total: number;
  completed_at: string | null;
}

export default function PackageDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useI18n();
  const el = lang === "el";
  const session = useSession();
  const router = useRouter();
  const list = useApi<{ packages: Pkg[] }>(`/v1/packages?lang=${lang}`);
  const progress = useApi<Progress>(session.visitor ? `/v1/me/progress/${id}` : null, "visitor");
  useFocusEffect(
    useCallback(() => {
      if (session.visitor) void progress.reload();
    }, [session.visitor, progress.reload]),
  );
  const pkg = list.data?.packages.find((p) => p.id === id);
  if (!pkg) return <State loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.loading && t.error} />;

  const doneAt = new Map(progress.data?.stops.filter((s) => s.done_at).map((s) => [s.target_id, s.done_at as string]));
  const nextIdx = pkg.stops.findIndex((s) => !doneAt.has(s.target_id));
  const done = progress.data?.done ?? 0;
  const total = progress.data?.total ?? pkg.stops.length;
  const completed = !!progress.data?.completed_at;
  const fmt = new Intl.DateTimeFormat(el ? "el-GR" : "en-GB", { day: "numeric", month: "short" });

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 96 }}>
      <Stack.Screen options={{ title: pkg.title }} />
      <View style={{ gap: space.xs }}>
        <Eyebrow>{el ? "Πακέτο εμπειριών" : "Experience package"}</Eyebrow>
        <H1>{pkg.title}</H1>
        {pkg.description ? <P>{pkg.description}</P> : null}
      </View>

      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        <Pill tone="sand" icon="location" label={`${pkg.stops.length} ${el ? "στάσεις" : "stops"}`} />
        <Pill icon="leaf" label={`+${VISITOR_POINTS.packageCompleted} ${t.points} ${el ? "με την ολοκλήρωση" : "on completion"}`} />
      </View>

      {session.visitor ? (
        <Card style={completed ? { backgroundColor: colors.green } : undefined}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Ionicons name={completed ? "ribbon" : "flag-outline"} size={26} color={completed ? "#fff" : colors.green} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.progTitle, completed && { color: "#fff" }]}>{completed ? t.completed : `${t.progress}: ${done} / ${total}`}</Text>
              {!completed && <P muted>{el ? "Σαρώστε τον κωδικό QR σε κάθε στάση." : "Scan the QR code at each stop."}</P>}
            </View>
          </View>
          {!completed && <Progress value={total ? done / total : 0} />}
        </Card>
      ) : (
        <Card style={{ backgroundColor: colors.greenSoft }}>
          <P>{el ? "Συνδεθείτε για να βλέπετε την πρόοδό σας και να κερδίζετε πόντους." : "Sign in to track your progress and earn points."}</P>
          <Button title={t.verify} onPress={() => router.push("/login")} />
        </Card>
      )}

      <View style={{ gap: space.sm }}>
        <H2>{el ? "Διαδρομή βήμα-βήμα" : "Step by step"}</H2>
        <View>
          {pkg.stops.map((s, i) => {
            const at = doneAt.get(s.target_id);
            const isNext = session.visitor && i === nextIdx && !completed;
            const last = i === pkg.stops.length - 1;
            const pts = pointsLabel(kindOfId(s.target_id) ?? "route");
            return (
              <View key={s.target_id} style={styles.row}>
                <View style={styles.rail}>
                  <View style={[styles.node, at ? styles.nodeDone : isNext ? styles.nodeNext : null]}>
                    {at ? <Ionicons name="checkmark" size={18} color="#fff" /> : <Text style={[styles.nodeText, isNext && { color: "#fff" }]}>{i + 1}</Text>}
                  </View>
                  {!last && <View style={[styles.line, at ? { backgroundColor: colors.greenBright } : null]} />}
                </View>
                <Pressable onPress={() => router.push(`/item/${s.target_id}`)} style={({ pressed }) => [styles.stop, isNext && styles.stopNext, pressed && { opacity: 0.85 }]}>
                  <Eyebrow color={at ? colors.greenBright : isNext ? colors.greenOnSoft : colors.textMuted}>
                    {`${el ? "Στάση" : "Stop"} ${i + 1}${at ? ` · ${el ? "Ολοκληρώθηκε" : "Done"} ${fmt.format(new Date(at))}` : isNext ? ` · ${el ? "Επόμενη" : "Next"}` : ""}`}
                  </Eyebrow>
                  <Text style={styles.stopTitle}>{s.name ?? s.target_id}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                    {pts ? <Pill tone={at ? "green" : "sand"} icon="leaf" label={`${pts} ${t.points}`} /> : null}
                    <View style={{ flex: 1 }} />
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  progTitle: { fontFamily: serif, fontSize: 18, lineHeight: 24, fontWeight: "700", color: colors.greenDark },
  row: { flexDirection: "row", gap: space.md },
  rail: { width: 34, alignItems: "center" },
  node: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.sand, borderWidth: 2, borderColor: colors.border },
  nodeDone: { backgroundColor: colors.green, borderColor: colors.green },
  nodeNext: { backgroundColor: colors.green, borderColor: colors.green },
  nodeText: { fontWeight: "800", color: colors.greenDark },
  line: { flex: 1, width: 3, backgroundColor: colors.border, marginVertical: 2, borderRadius: 2 },
  stop: { flex: 1, backgroundColor: colors.surface, borderRadius: 18, padding: space.md, gap: 6, marginBottom: space.md, borderWidth: 1, borderColor: colors.border },
  stopNext: { borderColor: colors.green, borderWidth: 2 },
  stopTitle: { fontFamily: serif, fontSize: 16, lineHeight: 21, fontWeight: "700", color: colors.greenDark },
});
