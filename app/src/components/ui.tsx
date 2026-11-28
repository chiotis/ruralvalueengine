import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, font, radius, serif, shadow, space } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function H1({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.h2, style]}>{children}</Text>;
}
export function P({ children, muted, style, numberOfLines }: { children: ReactNode; muted?: boolean; style?: object; numberOfLines?: number }) {
  // Body text has a fixed line height; a bigger font needs a taller line or Android clips the glyphs.
  const fontSize = (StyleSheet.flatten(style) as { fontSize?: number } | undefined)?.fontSize;
  const tall = fontSize && fontSize > font.body ? { lineHeight: Math.ceil(fontSize * 1.3) } : null;
  return (
    <Text numberOfLines={numberOfLines} style={[s.p, muted && { color: colors.textMuted }, tall, style]}>
      {children}
    </Text>
  );
}
/** Small capitals label above a title, e.g. "ΔΙΑΔΡΟΜΗ". */
export function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  return <Text style={[s.eyebrow, color ? { color } : null]}>{children}</Text>;
}

/** A section title with an optional link on the right ("All", "On the map"). */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={s.sectionHeader}>
      <H2 style={{ flex: 1 }}>{title}</H2>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={s.link}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
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

type ButtonKind = "primary" | "secondary" | "danger" | "ghost";
export function Button(props: { title: string; onPress: () => void; kind?: ButtonKind; disabled?: boolean; busy?: boolean; icon?: IconName; style?: ViewStyle }) {
  const k = props.kind ?? "primary";
  const bg = { primary: colors.green, danger: colors.burgundy, secondary: colors.sand, ghost: "transparent" }[k];
  const fg = k === "primary" || k === "danger" ? "#fff" : colors.greenDark;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg }, k === "ghost" && { borderWidth: 1.5, borderColor: colors.border }, props.style, (pressed || props.disabled) && { opacity: 0.7 }]}
    >
      {props.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={s.btnRow}>
          {props.icon ? <Ionicons name={props.icon} size={18} color={fg} /> : null}
          <Text style={[s.btnText, { color: fg }]}>{props.title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; icon?: IconName }) {
  const { label, style, icon, ...rest } = props;
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={s.inputWrap}>
        {icon ? <Ionicons name={icon} size={18} color={colors.textMuted} /> : null}
        <TextInput placeholderTextColor={colors.textMuted} style={[s.input, style]} {...rest} />
      </View>
    </View>
  );
}

export function Chip({ label, active, onPress, icon, dot }: { label: string; active?: boolean; onPress: () => void; icon?: IconName; dot?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={[s.chip, active && { backgroundColor: colors.green, borderColor: colors.green }]}>
      {dot ? <View style={[s.dot, { backgroundColor: dot }, active && { borderColor: "#fff" }]} /> : null}
      {icon ? <Ionicons name={icon} size={15} color={active ? "#fff" : colors.green} /> : null}
      <Text style={[s.chipText, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

/** A small rounded tag: points, distance, status. */
export function Pill({ label, icon, tone = "green" }: { label: string; icon?: IconName; tone?: "green" | "sand" | "burgundy" | "sky" | "solid" }) {
  const bg = { green: colors.greenSoft, sand: colors.sand, burgundy: colors.burgundySoft, sky: colors.skySoft, solid: colors.green }[tone];
  const fg = { green: colors.green, sand: colors.brown, burgundy: colors.burgundy, sky: colors.greenDark, solid: "#fff" }[tone];
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={13} color={fg} /> : null}
      <Text style={[s.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Stat({ label, value, icon }: { label: string; value: string | number; icon?: IconName }) {
  return (
    <View style={s.stat}>
      {icon ? (
        <View style={s.statIcon}>
          <Ionicons name={icon} size={16} color={colors.green} />
        </View>
      ) : null}
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/** A thin progress bar, 0..1. */
export function Progress({ value, color = colors.greenBright }: { value: number; color?: string }) {
  return (
    <View style={s.track}>
      <View style={[s.bar, { width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Thumb({ uri, size = 72, icon = "leaf-outline" }: { uri?: string | null; size?: number; icon?: IconName }) {
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.sand }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.greenSoft, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={icon} size={size / 2.6} color={colors.green} />
    </View>
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
  h1: { fontFamily: serif, fontSize: font.h1, lineHeight: 36, fontWeight: "700", color: colors.greenDark },
  h2: { fontFamily: serif, fontSize: font.title, lineHeight: 27, fontWeight: "700", color: colors.greenDark },
  p: { fontSize: font.body, color: colors.text, lineHeight: 22 },
  eyebrow: { fontSize: font.tiny, lineHeight: 15, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", color: colors.brown },
  link: { fontSize: font.small, fontWeight: "700", color: colors.green },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, ...shadow },
  btn: { borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
  btnRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  btnText: { fontSize: font.body, fontWeight: "700" },
  label: { fontSize: font.small, color: colors.textMuted, fontWeight: "600" },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, paddingVertical: space.md, fontSize: font.body, color: colors.text },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: font.small, color: colors.greenDark, fontWeight: "700" },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: "transparent" },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  pillText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, gap: 2, ...shadow },
  statIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.greenSoft, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statValue: { fontFamily: serif, fontSize: 26, lineHeight: 34, fontWeight: "700", color: colors.green },
  statLabel: { fontSize: font.small, color: colors.textMuted },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.sand, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4 },
});
