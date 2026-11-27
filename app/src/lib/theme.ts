// Mirrors docs/theme.json. Greens are the main colours; burgundy, brown and sky are accents.
export const colors = {
  greenDark: "#1c2c23",
  green: "#376245",
  greenBright: "#2d9141",
  burgundy: "#7a3123",
  brown: "#8a5a3c",
  sky: "#b1d1ea",
  background: "#FAF8F3",
  surface: "#FFFFFF",
  text: "#1c2c23",
  textMuted: "#5E6B63",
  border: "#E1E5DF",
  danger: "#7a3123",
} as const;

export const radius = { sm: 6, md: 12, lg: 20 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = { small: 13, body: 15, title: 20, h1: 26 } as const;
