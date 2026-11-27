import { useState } from "react";
import { View } from "react-native";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import type { CatalogSummary } from "../lib/api";
import { Card, Field, P } from "./ui";
import { colors, space } from "../lib/theme";

/** Search the network's businesses (each business is a member) and pick one. */
export function MemberPicker({ exclude, onPick }: { exclude?: string | null; onPick: (m: { id: string; name: string }) => void }) {
  const { lang } = useI18n();
  const [q, setQ] = useState("");
  const path = q.trim().length >= 2 ? `/v1/catalog/business?lang=${lang}&limit=8&q=${encodeURIComponent(q.trim())}` : null;
  const res = useApi<{ items: CatalogSummary[] }>(path);
  const items = (res.data?.items ?? []).filter((i) => i.id !== exclude);
  return (
    <View style={{ gap: space.sm }}>
      <Field label={lang === "el" ? "Αναζήτηση επιχείρησης" : "Search for a business"} value={q} onChangeText={setQ} autoCorrect={false} />
      {path &&
        items.map((i) => (
          <Card key={i.id} onPress={() => onPick({ id: i.id, name: i.title })} style={{ paddingVertical: space.sm }}>
            <P style={{ fontWeight: "600" }}>{i.title}</P>
            {i.subtitle ? <P muted>{i.subtitle}</P> : null}
          </Card>
        ))}
      {path && !res.loading && !items.length && <P style={{ color: colors.textMuted }}>{lang === "el" ? "Δεν βρέθηκε" : "Nothing found"}</P>}
    </View>
  );
}
