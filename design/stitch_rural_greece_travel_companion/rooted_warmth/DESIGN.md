---
name: Rooted Warmth
colors:
  surface: '#fbf9f2'
  surface-dim: '#dbdad3'
  surface-bright: '#fbf9f2'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f4ec'
  surface-container: '#efeee6'
  surface-container-high: '#eae8e1'
  surface-container-highest: '#e4e3db'
  on-surface: '#1b1c18'
  on-surface-variant: '#414942'
  inverse-surface: '#30312c'
  inverse-on-surface: '#f2f1e9'
  outline: '#717971'
  outline-variant: '#c1c9bf'
  surface-tint: '#376847'
  primary: '#316342'
  on-primary: '#ffffff'
  primary-container: '#4a7c59'
  on-primary-container: '#e1ffe5'
  inverse-primary: '#9dd3aa'
  secondary: '#705c30'
  on-secondary: '#ffffff'
  secondary-container: '#f8dca5'
  on-secondary-container: '#746034'
  tertiary: '#834751'
  on-tertiary: '#ffffff'
  tertiary-container: '#9f5f69'
  on-tertiary-container: '#fff5f5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b9efc5'
  primary-fixed-dim: '#9dd3aa'
  on-primary-fixed: '#00210e'
  on-primary-fixed-variant: '#1e5031'
  secondary-fixed: '#fbdfa8'
  secondary-fixed-dim: '#dec38e'
  on-secondary-fixed: '#251a00'
  on-secondary-fixed-variant: '#56441b'
  tertiary-fixed: '#ffd9dd'
  tertiary-fixed-dim: '#ffb2bc'
  on-tertiary-fixed: '#380b16'
  on-tertiary-fixed-variant: '#6d363f'
  background: '#fbf9f2'
  on-background: '#1b1c18'
  surface-variant: '#e4e3db'
  cream-bg: '#faf6f0'
  surface-warm: '#f4ede2'
  earth-dark: '#2e3230'
  amber-accent: '#8c6b2d'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: '600'
    lineHeight: 64px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
    letterSpacing: -0.005em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 3rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system is grounded in calm, organic humanism paired with systematic modern utility. Built for clear digital interactions with a grounded tactile essence, it strips away synthetic sheen in favor of botanical warmth, balanced airiness, and purposeful legibility. 

The aesthetic is Modern Organic Minimalist. It pairs the disciplined clarity and universal readability of Inter with an earthy, warm chromatic ecosystem. High whitespace ratios, quiet container transitions, and natural pigment tones create an approachable, high-trust digital environment free of clinical coldness or performative flair.

## Colors

The chromatic palette relies on low-saturation pigments extracted from foliage, loam, and unbleached fiber. 

- **Primary (`#4a7c59`)**: Muted pine leaf green for interactive controls, key wayfinding indicators, and primary visual emphasis.
- **Secondary (`#705c30`)**: Sun-cured earth amber for secondary accents, contextual badges, and nuanced metadata.
- **Background (`#faf6f0`)**: Porous warm cream serving as the canvas base. Never substitute with `#ffffff` or clinical blue-tinted cool slates.
- **Neutrals**: Base grays are warm-tinted and desaturated. Deep typographic body copy uses `earth-dark` (`#2e3230`), ensuring high contrast against cream surfaces while avoiding harsh, unnatural black.

## Typography

Inter serves across all tiers to provide uninterrupted UI legibility, technical precision, and robust polytonic and monotonic Greek character coverage. By deploying a single versatile neo-grotesque across both titles and body text, structural balance is maintained through rigorous weight stepping and open vertical line metrics rather than typeface switching.

Maintain generous line heights (1.6x equivalent on body levels) to honor the unhurried cadence of the system. Letter tracking stays subtly tightened across display and large headlines to keep headings cohesive, transitioning to neutral and slightly tracked spacing on micro-labels and UI metadata.

## Layout & Spacing

The layout operates on a standard 12-column responsive fluid grid anchored by expansive outer margins. On viewports below 768px, the system collapses to a single-column or 4-column flow with tightened margins (`margin-mobile`), maintaining breathable horizontal whitespace to prevent edge collision.

Component rhythm adheres to an 8px base increment. Padding within containers stays open and generous: elements must never feel dense or compressed. Section-level vertical offsets prioritize separation through empty cream space over horizontal rules or explicit dividing lines.

## Elevation & Depth

Spatial layering relies predominantly on tonal stacking over artificial dropshadows. Primary page content sits on `cream-bg` (`#faf6f0`), while elevated cards, overlays, and modal tiers leverage `surface-warm` (`#f4ede2`) or deliberate, semi-transparent layers.

When elevation must be reinforced for floating navigation, menus, or interactive draw-offs, use an ultra-diffused, ambient shadow:
`box-shadow: 0 4px 20px rgba(46, 50, 48, 0.06);`

Outlines take precedence over hard edges. Where tonal contrast requires bounding, use a subtle 1px border colored with deep neutral tones set to 8–12% opacity. Sharp dropshadows, colored glow states, and heavy structural borders are strictly prohibited.

## Shapes

The interface embraces a balanced curvature model (scale level 2). Standard interface containers, buttons, and form inputs utilize 0.5rem (8px) corner rounding. Cards, nested groupings, and modals utilize `rounded-lg` (1rem / 16px) or `rounded-xl` (1.5rem / 24px) to retain an organic, softened physical presence.

Fully pill-shaped geometries (9999px) are reserved strictly for standalone chips, status badges, and compact button variants. No corner across the system should remain completely sharp.

## Components

### Buttons
- **Primary:** Solid `#4a7c59` fill, `#faf6f0` text, `0.5rem` border-radius. Inter `label-md` with 44px minimum touch height (`12px 24px` padding).
- **Secondary:** Transparent fill, 1px border in `#4a7c59` (40% opacity), text in `#4a7c59`.
- **Tertiary/Ghost:** Transparent fill, no border, text in `#2e3230`, background shifts to `rgba(74, 124, 89, 0.08)` on hover.

### Form Inputs
- **Base:** Fill in `#faf6f0` or `#ffffff`, 1px border in `rgba(46, 50, 48, 0.15)`, radius `0.5rem`, padding `12px 16px`.
- **Focus:** Border transitions to `#4a7c59` with a subtle `0 0 0 3px rgba(74, 124, 89, 0.15)` ambient ring. No stark browser defaults.

### Cards
- **Construction:** Warm fill (`#f4ede2` or `#ffffff` depending on page layer), `1rem` radius, `space-lg` (24px) internal padding.
- **Hierarchy:** Surface differentiation without harsh perimeter strokes. Use the `0 4px 20px rgba(46, 50, 48, 0.06)` shadow for elevated variants.

### Chips & Badges
- **Structure:** Pill-shaped (`rounded-full`), height `28px` to `32px`, horizontal padding `12px`.
- **Colors:** Light tint backgrounds derived from tone (e.g., `rgba(112, 92, 48, 0.12)` for amber categories), text colored with `#705c30`.

### Selection Controls (Checkboxes & Radios)
- **Checkboxes:** `0.25rem` radius, 20px box, border in `rgba(46, 50, 48, 0.3)`. Checked state fills with `#4a7c59` with an ivory check mark.
- **Radios:** Concentric circle, outer ring with `#4a7c59` active fill and warm cream internal dot.