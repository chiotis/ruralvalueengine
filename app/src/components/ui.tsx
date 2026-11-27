import type { ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { colors, font, radius, space } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export function H1({ children }: { children: ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  return <Text style={s.h2}>{children}</Text>;
}
export function P({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[s.p, muted && { color: colors.textMuted }, style]}>{children}</Text>;
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        {children}
      </Pressable>
    );
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button(props: { title: string; onPress: () => void; kind?: "primary" | "secondary" | "danger"; disabled?: boolean; busy?: boolean }) {
  const k = props.kind ?? "primary";
  const bg = k === "primary" ? colors.greenBright : k === "danger" ? colors.burgundy : colors.surface;
  const fg = k === "secondary" ? colors.green : "#fff";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: k === "secondary" ? colors.green : bg }, (pressed || props.disabled) && { opacity: 0.7 }]}
    >
      {props.busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{props.title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.textMuted} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: colors.green, borderColor: colors.green }]}>
      <Text style={[s.chipText, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export function Thumb({ uri, size = 72 }: { uri?: string | null; size?: number }) {
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.border }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.sky }} />
  );
}

/** Loading / error / empty states for any list or screen. */
export function State({ loading, error, empty, onRetry }: { loading?: boolean; error?: Error | null; empty?: string | false; onRetry?: () => void }) {
  const { t } = useI18n();
  if (loading) return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.green} />;
  if (error)
    return (
      <View style={{ gap: space.md, alignItems: "center", marginTop: space.xl }}>
        <P muted>{t.error}</P>
        {onRetry && <Button kind="secondary" title={t.retry} onPress={onRetry} />}
      </View>
    );
  if (empty) return <P muted style={{ textAlign: "center", marginTop: space.xl }}>{empty}</P>;
  return null;
}

export const s = StyleSheet.create({
  h1: { fontSize: font.h1, fontWeight: "700", color: colors.greenDark },
  h2: { fontSize: font.title, fontWeight: "700", color: colors.greenDark },
  p: { fontSize: font.body, color: colors.text, lineHeight: 22 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: space.sm },
  btn: { borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: space.lg, alignItems: "center", borderWidth: 1.5 },
  btnText: { fontSize: font.body, fontWeight: "700" },
  label: { fontSize: font.small, color: colors.textMuted, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, fontSize: font.body, backgroundColor: colors.surface, color: colors.text },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: space.md, backgroundColor: colors.surface },
  chipText: { fontSize: font.small, color: colors.text, fontWeight: "600" },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.green },
  statLabel: { fontSize: font.small, color: colors.textMuted },
});
