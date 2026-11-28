import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "../lib/theme";

const PALETTE = [colors.greenBright, colors.green, colors.burgundy, colors.brown, colors.sky, "#E9C46A"];

/** A short burst of falling confetti over its parent. Pure Animated, no native module. */
export function Confetti({ count = 30, height = 420, width = 360 }: { count?: number; height?: number; width?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        drift: (Math.random() - 0.5) * 80,
        delay: Math.random() * 0.25,
        spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        round: i % 4 === 0,
        color: PALETTE[i % PALETTE.length],
      })),
    [count, width],
  );
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [t]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => {
        const local = t.interpolate({ inputRange: [0, p.delay, 1], outputRange: [0, 0, 1], extrapolate: "clamp" });
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: -20,
              width: p.w,
              height: p.round ? p.w : p.h,
              borderRadius: p.round ? p.w / 2 : 2,
              backgroundColor: p.color,
              opacity: local.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateY: local.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) },
                { translateX: local.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
                { rotate: local.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spin}deg`] }) },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
