import { Platform } from "react-native";

// Mirrors docs/theme.json. Greens are the main colours; burgundy, brown and sky are accents.
// The warm neutrals (cream, sand, line) come from the 2026-11 redesign (design/ folder).
export const colors = {
  greenDark: "#1c2c23",
  green: "#376245",
  greenBright: "#2d9141",
  greenSoft: "#E2EEE4",
  burgundy: "#7a3123",
  burgundySoft: "#F6E4DF",
  brown: "#8a5a3c",
  sand: "#F1E9DC",
  sky: "#b1d1ea",
  skySoft: "#E6F0F8",
  background: "#FAF6F0",
  surface: "#FFFFFF",
  text: "#1c2c23",
  textMuted: "#5E6B63",
  border: "#E8E1D5",
  danger: "#7a3123",
} as const;

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = { tiny: 11, small: 13, body: 15, title: 20, h1: 28 } as const;

/** Headings use the platform serif until the brand fonts are confirmed (docs/SPEC.md, still open). */
export const serif = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, serif" });

/** Soft card shadow, the same on both platforms. */
export const shadow = {
  shadowColor: "#3b2f1e",
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;
