import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, radius, space } from "../lib/theme";

/** A card that slides up from the bottom over a dimmed screen. */
export function Sheet({ visible, onClose, children, overlay }: { visible: boolean; onClose: () => void; children: ReactNode; overlay?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          {overlay}
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Ionicons name="close" size={20} color={colors.greenDark} />
          </Pressable>
          <ScrollView bounces={false} contentContainerStyle={{ gap: space.md, paddingTop: space.sm }}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(28,44,35,0.55)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    overflow: "hidden",
  },
  close: { position: "absolute", top: space.md, right: space.md, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.sand, alignItems: "center", justifyContent: "center", zIndex: 2 },
});
