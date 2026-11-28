// Mirrors docs/theme.json. Dark green like ruralgreece.gr (Chris, 2026-11-28): the site's #1c2c23 is the
// background, the favicon green #2d9141 the main action colour, and text is light on top.
// Names describe the role a colour plays in the app; the brand hex values are noted beside them.
export const colors = {
  /** Text and icons on the dark background (headings). */
  greenDark: "#F3F1EA",
  /** Main action: buttons, active chips, links. Brand favicon green. */
  green: "#2d9141",
  /** Success, progress and the route pins. */
  greenBright: "#5BC274",
  /** Tint behind green text and icons (points pills, icon circles). */
  greenSoft: "#264A33",
  /** Green text on a greenSoft tint. */
  greenOnSoft: "#9FDDAE",
  burgundy: "#D06A52",
  burgundySoft: "#4A2C25",
  /** Eyebrow labels and warm accents (brand brown #8a5a3c, lightened for the dark background). */
  brown: "#DDB48E",
  /** Secondary buttons, tracks, segment backgrounds. */
  sand: "#2E4637",
  sky: "#b1d1ea",
  skySoft: "#2A3F49",
  /** Page background: ruralgreece.gr's #1c2c23. */
  background: "#1c2c23",
  /** Cards and sheets, one step lighter than the page. */
  surface: "#243A2D",
  text: "#F3F1EA",
  textMuted: "#B3C1B7",
  border: "#38503F",
  danger: "#D06A52",
  /** The brand's darkest green, for text on light chips (sky). */
  ink: "#1c2c23",
} as const;

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = { tiny: 11, small: 13, body: 15, title: 20, h1: 28 } as const;

/** Inter for all text, embedded at build time by the expo-font plugin in app.json (400–800). */
export const inter = "Inter";
/** Kept for the heading styles; headings use Inter too now. */
export const serif = inter;

/** Soft card shadow, the same on both platforms. */
export const shadow = {
  shadowColor: "#000",
  shadowOpacity: 0.25,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
} as const;
