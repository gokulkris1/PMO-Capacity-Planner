# PMO Capacity Planner: Design System "Corporate Blue" (Release 2.0)

| | |
|---|---|
| Owner | Business Analyst (with PO and UX), PMO Capacity Planner |
| Date | 16 October 2026 |
| Source | `docs/product/PRODUCT_BRIEF.md` §3.2 "Corporate Blue", made precise and complete here |
| Implemented by | Package B (`styles/tokens.css`, `styles/base.css`, `components/ui/**`, `components/shell/**`); stories DS-01…DS-08, SH-02, SH-03 in `docs/product/BACKLOG.md` |
| Status | **Single source of truth.** If code and this document disagree, this document wins; change it first (BA/PO approval), then the code. |

**Principles.** Quiet chrome, loud data. One accent colour (blue); status colours mean status and nothing else. Dense but legible tables. Every number states its time basis. Designed to sit inside Jira without imitating it. Accessible by construction (WCAG 2.1 AA).

**What changed from the PO brief (and why).** Every value in the brief is kept except: (1) `--color-text-tertiary` is `#5E6C84` instead of `#637189`, because `#637189` on the table-header/sunken surface `#EEF1F6` measures 4.36:1 (below AA); `#5E6C84` measures 4.69:1 there and 5.31:1 on white. (2) The "Available" (bench) band uses `--color-text-secondary` on `--color-surface-sunken` (6.76:1) for the same reason. (3) The chart palette keeps the brief's first six hues but replaces slots 7–8 (slate and navy failed the chroma/lightness checks for identity colours) with sky `#2E93D1` and sienna `#9A5B2E`; slate and navy become the reserved neutrals "Other/unmapped" and "Target/total". Teal moved from `#0E8C9A` to `#00897A` (chroma floor). All ratios below were computed (WCAG 2.1 relative luminance); the chart palette was run through the colour-blind validator (Machado 2009, protan/deutan) in both themes.

---

## 1. How to use this system

1. **Tokens only.** Components reference CSS custom properties (`var(--color-…)`, `var(--space-…)`). No hex, `rgb()` or named colours in `components/**` or `pages/**` (lint rule, DS-07). The only files that contain colour literals are `styles/tokens.css` and the PDF palette in `utils/pdfExport.ts` (§11.5).
2. **Classes, not inline styles.** Visual styling lives in component CSS files with the `pcp-` prefix (BEM-style: `.pcp-button`, `.pcp-button--primary`, `.pcp-button__icon`). Inline `style` is allowed only for geometry computed at runtime (`width`, `height`, `transform`, `gridTemplateColumns`, `left`), never for colour, background, border colour, fill or stroke.
3. **Primitives first.** Pages compose `components/ui` primitives. A page that needs something new asks for a primitive (B owns it) rather than styling a one-off.
4. **Theme switch.** Theme is an attribute on `<html>`: `data-theme="light"` (default in 2.0) or `data-theme="dark"` (Could, XT-01). Embedded-in-Jira mode adds `data-embedded="atlassian"` (Release 3.0; mapping in §2.6).
5. **Icons** come from `lucide-react` only (§10). **No emoji** anywhere in the UI, including empty states, buttons and toasts.

---

## 2. Colour

### 2.1 Brand and interaction (light)

| Token | Hex | Use | Contrast (verified) |
|---|---|---|---|
| `--color-primary` | `#1F5FCC` | Primary button fill, selected tab underline, active toggles, slider/checkbox fill, above-the-table series | 5.89:1 on white; white text on it 5.89:1 |
| `--color-primary-hover` | `#184EA8` | Primary hover | white text 7.80:1 |
| `--color-primary-pressed` | `#123F8A` | Primary active/pressed | white text 9.98:1 |
| `--color-primary-subtle` | `#EBF2FD` | Selected row, selected menu item, info chip, avatar background, bulk-action bar | primary text on it 5.23:1 |
| `--color-primary-border` | `#B7CDF3` | Selected card/input border (decorative, paired with another cue) | — |
| `--color-on-primary` | `#FFFFFF` | Text/icons on primary or danger fills | — |
| `--color-link` | `#1F5FCC` | Links and link buttons | 5.89:1 on white, 5.53:1 on row hover |
| `--color-link-hover` | `#184EA8` | Link hover (plus underline) | 7.80:1 |
| `--color-focus` | `#4C8DF6` | 2 px focus ring, 2 px offset | 3.26:1 vs white, 5.07:1 vs navy (UI ≥ 3:1) |

### 2.2 App chrome (navy sidebar)

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--color-nav-bg` | `#0B1F3A` | Sidebar background | — |
| `--color-nav-hover` | `#13294B` | Item hover | nav-text 9.51:1 |
| `--color-nav-active` | `#1B3A66` | Active item background | white 11.39:1 |
| `--color-nav-border` | `#1B3A66` | Divider above the bottom group | — |
| `--color-nav-text` | `#C7D2E3` | Item labels and icons | 10.82:1 on nav-bg |
| `--color-nav-text-active` | `#FFFFFF` | Active and hovered label | — |
| `--color-nav-muted` | `#8C9DB8` | Group headings | 6.00:1 |
| `--color-nav-accent` | `#6FA4FF` | Active indicator bar and active icon | 6.63:1 |

### 2.3 Neutrals: surfaces, borders, text (light)

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--color-bg` | `#F4F6F9` | Page background (behind cards) | — |
| `--color-surface` | `#FFFFFF` | Cards, tables, drawers, top bar, inputs | — |
| `--color-surface-raised` | `#FFFFFF` | Menus, popovers, dialogs, toasts (with elevation) | — |
| `--color-surface-sunken` | `#EEF1F6` | Table header, group rows, read-only inputs, segmented-control track, code/kbd | — |
| `--color-surface-hover` | `#F5F8FC` | Table row hover, menu item hover | tertiary text 4.99:1 |
| `--color-chip-bg` | `#E3E8EF` | Filled craft chip, neutral lozenge | text 12.79:1, secondary 6.22:1 |
| `--color-scrim` | `rgba(11, 31, 58, 0.48)` | Overlay behind dialogs and drawers | — |
| `--color-border` | `#DCE2EA` | Card and table dividers (decorative only) | — |
| `--color-border-strong` | `#B8C3D2` | Section dividers, secondary-button border | — |
| `--color-border-input` | `#7D8AA0` | Form-control borders, outlined chip border, checkbox border | 3.49:1 (UI ≥ 3:1) |
| `--color-border-input-hover` | `#5E6C84` | Control border on hover | 5.31:1 |
| `--color-text` | `#14233B` | Primary text, numbers, headings | 15.75:1 on white, 14.55:1 on bg |
| `--color-text-secondary` | `#44546F` | Labels, table headers, secondary text | 7.65:1 on white, 6.76:1 on sunken |
| `--color-text-tertiary` | `#5E6C84` | Helper text, captions, axis labels, placeholders (never lighter) | 5.31:1 white, 4.91:1 bg, 4.69:1 sunken |
| `--color-text-disabled` | `#9AA6B8` | Disabled control text only (WCAG-exempt) | 2.46:1 |
| `--color-text-inverse` | `#FFFFFF` | Text on navy or dark fills | — |
| `--color-tooltip-bg` | `#14233B` | Tooltip background | white text 15.75:1 |
| `--color-tooltip-text` | `#FFFFFF` | Tooltip text | — |
| `--color-skeleton` | `#E3E8EF` | Skeleton block | — |
| `--color-skeleton-shine` | `#F4F6F9` | Skeleton shimmer highlight | — |

### 2.4 Status and utilisation bands (light)

Status colours are **reserved**: they encode state (utilisation band, sync health, approval, destructive action) and are never used for projects, crafts, tribes or chart series identity. Every status display pairs colour with an icon and/or text.

| Token set | Text/icon `--color-X` | Background `--color-X-bg` | Border `--color-X-border` | Fill `--color-X-fill` | Contrast (text on white / on bg) |
|---|---|---|---|---|---|
| success | `#17744A` | `#E6F4EC` | `#A8D5BC` | `#2E9E6A` | 5.78 / 5.10 |
| warning | `#A35200` | `#FFF3E0` | `#F5C98A` | `#F5A524` | 5.58 / 5.09 (text `#14233B` on fill: 7.72) |
| danger | `#C22E2E` | `#FDECEC` | `#F2B8B8` | `#C22E2E` | 5.64 / 4.94 (white on fill: 5.64) |
| info | `#0B6E8F` | `#E3F3F8` | `#A9D8E6` | `#0B6E8F` | 5.77 / 5.06 |
| neutral | `#44546F` | `#EEF1F6` | `#B8C3D2` | `#5E6C84` | 7.65 / 6.76 |

Extra interaction tokens: `--color-danger-hover #A32424` (white 7.41:1), `--color-danger-pressed #8A1E1E` (white 9.19:1).

**Utilisation bands** (default thresholds; org-configurable in Settings › Planning; computed by `shared/utilisation.ts` on load as a % of the person's target, rounded to an integer):

| Band (`UtilBand`) | Range | Label | Foreground token | Background token | Icon (lucide) |
|---|---|---|---|---|---|
| `bench` | < 50 % | Available | `--band-bench-fg` = `--color-text-secondary` | `--band-bench-bg` = `--color-surface-sunken` | `Circle` |
| `under` | 50–89 % | Under target | `--band-under-fg` = `--color-warning` | `--band-under-bg` = `--color-warning-bg` | `CircleArrowDown` |
| `on-target` | 90–105 % | On target | `--band-on-target-fg` = `--color-success` | `--band-on-target-bg` = `--color-success-bg` | `CircleCheck` |
| `over` | > 105 % | Over capacity | `--band-over-fg` = `--color-danger` | `--band-over-bg` = `--color-danger-bg` | `TriangleAlert` |

Other status mappings: sync OK = success, stale sync / pending approval / tentative = warning, sync failed / destructive = danger, "Planview-sourced" provenance / neutral notices = info, Draft / archived = neutral.

### 2.5 Dark theme mapping (`:root[data-theme="dark"]`)

Dark theme is **Could** (XT-01) but its tokens are defined now so no component needs to change later. The values are a selected mapping (not an automatic inversion) and were contrast-checked against the dark surfaces.

| Token | Light | Dark | Dark contrast (verified) |
|---|---|---|---|
| `--color-bg` | `#F4F6F9` | `#0E1522` | — |
| `--color-surface` | `#FFFFFF` | `#141C2B` | — |
| `--color-surface-raised` | `#FFFFFF` | `#1A2436` | — |
| `--color-surface-sunken` | `#EEF1F6` | `#101827` | — |
| `--color-surface-hover` | `#F5F8FC` | `#1A2436` | tertiary 5.47:1 |
| `--color-chip-bg` | `#E3E8EF` | `#2A3447` | text 10.43:1, secondary 6.72:1 |
| `--color-scrim` | `rgba(11,31,58,.48)` | `rgba(0,0,0,.60)` | — |
| `--color-border` | `#DCE2EA` | `#2A3447` | — |
| `--color-border-strong` | `#B8C3D2` | `#3A465C` | — |
| `--color-border-input` | `#7D8AA0` | `#6B7A93` | 3.92:1 |
| `--color-border-input-hover` | `#5E6C84` | `#8D9AB0` | — |
| `--color-text` | `#14233B` | `#E6EBF2` | 14.24:1 on surface, 15.26:1 on bg |
| `--color-text-secondary` | `#44546F` | `#B4BFCF` | 9.18:1 |
| `--color-text-tertiary` | `#5E6C84` | `#8D9AB0` | 6.00:1 surface, 5.47:1 raised, 6.25:1 sunken |
| `--color-text-disabled` | `#9AA6B8` | `#5D6A80` | exempt |
| `--color-text-inverse` | `#FFFFFF` | `#14233B` | — |
| `--color-primary` | `#1F5FCC` | `#2F6FDB` | white text 4.75:1 |
| `--color-primary-hover` | `#184EA8` | `#255FC4` | white 5.98:1 |
| `--color-primary-pressed` | `#123F8A` | `#1F55B0` | white 7.04:1 |
| `--color-primary-subtle` | `#EBF2FD` | `#1A2C4D` | link on it 5.83:1 |
| `--color-primary-border` | `#B7CDF3` | `#2F4C7E` | — |
| `--color-link` / `-hover` | `#1F5FCC` / `#184EA8` | `#7EA8F5` / `#A3C2F8` | 7.16:1 |
| `--color-focus` | `#4C8DF6` | `#6FA4FF` | 6.85:1 |
| `--color-nav-bg` | `#0B1F3A` | `#0A1220` | nav-text 12.28:1 |
| `--color-nav-hover` / `-active` | `#13294B` / `#1B3A66` | `#121C30` / `#1B2B47` | nav-text on active 9.28:1 |
| `--color-nav-muted` | `#8C9DB8` | `#8C9DB8` | 6.81:1 |
| `--color-success` / `-bg` | `#17744A` / `#E6F4EC` | `#4CC38A` / `#10291E` | 7.70 / 6.98 |
| `--color-warning` / `-bg` | `#A35200` / `#FFF3E0` | `#F0A54A` / `#2E2210` | 8.28 / 7.53 |
| `--color-danger` / `-bg` | `#C22E2E` / `#FDECEC` | `#F07171` / `#33181A` | 5.94 / 5.68 |
| `--color-danger-fill` | `#C22E2E` | `#C22E2E` | white 5.64 |
| `--color-info` / `-bg` | `#0B6E8F` / `#E3F3F8` | `#4FB5D6` / `#0F2731` | 7.24 / 6.58 |
| `--color-tooltip-bg` / `-text` | `#14233B` / `#FFFFFF` | `#E6EBF2` / `#14233B` | 13.15:1 |
| `--color-skeleton` / `-shine` | `#E3E8EF` / `#F4F6F9` | `#1F2A3D` / `#26324A` | — |
| Elevation shadows | navy alpha (§6) | `rgba(0,0,0,.40/.50/.60)` + 1 px `--color-border` | — |
| Chart series | §11.1 light | §11.1 dark | validated |

The `-border` and `-fill` variants of status colours in dark: success `#2B6B4B`/`#4CC38A`, warning `#6B4A1A`/`#F5A524`, danger `#6E2A2D`/`#C22E2E`, info `#1D5266`/`#4FB5D6`, neutral `#3A465C`/`#8D9AB0`.

### 2.6 Mapping to Atlassian design tokens (Release 3.0 embedded mode)

In Release 3.0 the app runs in a Jira iframe and must inherit Jira's light/dark theme. Our tokens stay the API for components; only their definitions change, under `:root[data-embedded="atlassian"]`, each as `var(--ds-…, <our light value>)`. Nothing in components changes. Do **not** use Atlassian brand colours (`#0C66E4`, `#0052CC`) as our own brand, Atlaskit packages, or Atlassian logos in 2.0.

| Our token | Atlassian token |
|---|---|
| `--color-text` / `-secondary` / `-tertiary` / `-disabled` / `-inverse` | `--ds-text` / `--ds-text-subtle` / `--ds-text-subtlest` / `--ds-text-disabled` / `--ds-text-inverse` |
| `--color-link` / `-hover` | `--ds-link` / `--ds-link-pressed` |
| `--color-primary` / `-hover` / `-pressed` | `--ds-background-brand-bold` / `--ds-background-brand-bold-hovered` / `--ds-background-brand-bold-pressed` |
| `--color-primary-subtle` | `--ds-background-selected` |
| `--color-on-primary` | `--ds-text-inverse` |
| `--color-focus` | `--ds-border-focused` |
| `--color-bg` / `--color-surface` / `--color-surface-raised` / `--color-surface-sunken` | `--ds-surface` / `--ds-surface-raised` / `--ds-surface-overlay` / `--ds-surface-sunken` |
| `--color-surface-hover` | `--ds-background-neutral-subtle-hovered` |
| `--color-chip-bg` | `--ds-background-neutral` |
| `--color-border` / `-strong` / `-input` | `--ds-border` / `--ds-border-bold` / `--ds-border-input` |
| `--color-success` / `-bg` | `--ds-text-success` / `--ds-background-success` |
| `--color-warning` / `-bg` / `-fill` | `--ds-text-warning` / `--ds-background-warning` / `--ds-background-warning-bold` |
| `--color-danger` / `-bg` / `-fill` | `--ds-text-danger` / `--ds-background-danger` / `--ds-background-danger-bold` |
| `--color-info` / `-bg` | `--ds-text-information` / `--ds-background-information` |
| `--elevation-1` / `-2` / `-3` | `--ds-shadow-raised` / `--ds-shadow-overlay` / `--ds-shadow-overlay` |
| `--space-*` | `--ds-space-*` (same names and values, §4) |
| `--color-nav-*` | not used (Jira provides the chrome; shell hides the sidebar) |
| `--chart-*` | kept as ours (validated palette); re-validate against `--ds-surface` dark at 3.0 |

Spacing token names deliberately mirror Atlassian's (`space.100 = 8px`) so the mapping is 1:1.

---

## 3. Typography

**Font: Inter**, variable weights 400/500/600/700, **self-hosted** with `@fontsource-variable/inter` (imported once in `index.tsx`). No Google Fonts or other CDNs (required for CSP, corporate proxies and Forge). Fallback stack: `'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`. Monospace (rare: keys, ids): `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`.

Base: `html { font-size: 100% }`, `body { font: 400 14px/20px var(--font-sans); color: var(--color-text); background: var(--color-bg); -webkit-font-smoothing: antialiased; font-feature-settings: "ss01"; }`. `ss01` gives Inter's open digits, which separate 1/l and 6/8 better in dense tables.

| Role (class / token prefix) | Size / line-height | Weight | Letter-spacing | Use |
|---|---|---|---|---|
| `display` | 28 / 36 | 600 | −0.01em | Sign-in card title only |
| `h1` | 24 / 32 | 600 | −0.01em | Page title (one per page) |
| `h2` | 20 / 28 | 600 | 0 | Section title, dialog title |
| `h3` | 16 / 24 | 600 | 0 | Card title, drawer title |
| `body` | 14 / 20 | 400 | 0 | Default text |
| `body-strong` | 14 / 20 | 600 | 0 | Emphasis, table row primary label |
| `body-medium` | 14 / 20 | 500 | 0 | Buttons, tabs, nav items |
| `table` | 13 / 18 | 400 | 0 | Table cells (compact and comfortable) |
| `table-strong` | 13 / 18 | 600 | 0 | Table totals, header labels use `caption-strong` |
| `caption` | 12 / 16 | 400 | 0 | Helper text, KPI caption, timestamps |
| `caption-strong` | 12 / 16 | 600 | 0 | Table headers, chip text, KPI label |
| `overline` | 11 / 16 | 600 | +0.04em, uppercase | Lozenges, nav group headings (max one overline per card) |
| `kpi-value` | 28 / 36 | 600 | −0.01em, `tabular-nums` | KPI tile value only |

Tokens: `--font-sans`, `--font-mono`, `--text-{role}-size`, `--text-{role}-line`, `--text-{role}-weight` (e.g. `--text-h1-size: 24px`). Rules: **no weights 300, 800 or 900**; no type larger than 28 px inside the app; numbers in tables, KPI tiles, cells, badges and charts use `font-variant-numeric: tabular-nums`; percentages and FTE are right-aligned; one decimal for FTE (`0.5 FTE`), integers for % (`95%`), thin space not used. Truncate single-line labels with ellipsis and expose the full text via `title` or Tooltip.

---

## 4. Spacing

4 px base. Names mirror Atlassian `space.*` tokens.

| Token | Value | Typical use |
|---|---|---|
| `--space-0` | 0 | — |
| `--space-025` | 2px | Chip internal gap, focus offset |
| `--space-050` | 4px | Icon–label gap in chips, tight stacks |
| `--space-075` | 6px | Lozenge horizontal padding |
| `--space-100` | 8px | Button icon gap, table cell vertical padding (comfortable), inline gaps |
| `--space-150` | 12px | Table cell horizontal padding, input horizontal padding, nav item padding |
| `--space-200` | 16px | Card padding (dense), mobile/embedded page gutter, form field gap |
| `--space-250` | 20px | — |
| `--space-300` | 24px | Card padding (default), page gutter, dialog padding, section gap |
| `--space-400` | 32px | Large section gap |
| `--space-500` | 40px | — |
| `--space-600` | 48px | Empty-state padding |
| `--space-800` | 64px | Sidebar rail width (layout token `--sidebar-collapsed`) |

Layout tokens: `--sidebar-width: 248px`, `--sidebar-collapsed: 64px`, `--topbar-height: 56px`, `--page-gutter: 24px` (16px below 768 px and in embedded mode), `--drawer-sm: 480px`, `--drawer-lg: 720px`, `--dialog-sm: 400px`, `--dialog-md: 560px`, `--dialog-lg: 800px`, `--control-height-sm: 28px`, `--control-height-md: 32px`, `--control-height-lg: 40px`, `--row-compact: 32px`, `--row-comfortable: 40px`.

---

## 5. Radii

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 3px | Chips, lozenges, checkboxes, kbd, quarter load bar ends |
| `--radius-sm` | 4px | Buttons, inputs, selects, segmented control, menu items, tooltips |
| `--radius-md` | 6px | Cards, tables, KPI tiles, banners, toasts |
| `--radius-lg` | 8px | Dialogs, drawers (left corners), popovers, menus |
| `--radius-full` | 9999px | Avatars, switch track/knob, notification count badge |

---

## 6. Elevation and layering

### 6.1 Elevation (shadows)

| Token | Light value | Dark value | Use |
|---|---|---|---|
| `--elevation-0` | `none` (use 1 px `--color-border`) | same | Cards, tables, KPI tiles |
| `--elevation-1` | `0 1px 2px rgba(11, 31, 58, 0.08)` | `0 1px 2px rgba(0, 0, 0, 0.40)` | Sticky table header when scrolled, sticky first column edge, segmented-control active segment |
| `--elevation-2` | `0 4px 12px rgba(11, 31, 58, 0.12)` | `0 4px 12px rgba(0, 0, 0, 0.50)` | Menus, popovers, comboboxes, tooltips, toasts |
| `--elevation-3` | `0 12px 32px rgba(11, 31, 58, 0.18)` | `0 12px 32px rgba(0, 0, 0, 0.60)` | Dialogs, drawers |

No coloured glows, no gradients, no decorative blobs, no glass effects.

### 6.2 Z-index layers

| Token | Value | Layer |
|---|---|---|
| `--z-base` | 0 | Page content |
| `--z-sticky` | 10 | Sticky table header / first column |
| `--z-sticky-corner` | 11 | Top-left sticky cell |
| `--z-page-header` | 20 | Sticky page header (if used) and bulk-action bar |
| `--z-sidebar` | 100 | Sidebar |
| `--z-topbar` | 110 | Top bar |
| `--z-dropdown` | 1000 | Menus, popovers, combobox listbox, date picker |
| `--z-drawer` | 1100 | Drawer and its scrim |
| `--z-modal` | 1200 | Dialog and its scrim (above drawers: a confirm can open from a drawer) |
| `--z-toast` | 1300 | Toast stack |
| `--z-tooltip` | 1400 | Tooltips |
| `--z-skip-link` | 1500 | "Skip to content" link when focused |

---

## 7. Motion

| Token | Value | Use |
|---|---|---|
| `--duration-fast` | 120ms | Hover, press, colour and border transitions, chevron rotation |
| `--duration-base` | 200ms | Drawer slide, dialog fade/scale (0.98 → 1), sidebar collapse |
| `--duration-slow` | 300ms | Toast enter/exit |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Enter and move |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Exit |

Rules: animate `opacity` and `transform` only (no layout properties). Skeleton shimmer 1.2 s linear infinite. `@media (prefers-reduced-motion: reduce)` sets every duration token to `0ms` and disables shimmer. No auto-playing or looping decorative motion. Tooltip show delay 300 ms, hide 0 ms.

---

## 8. Components

Every component lives in `components/ui/<Name>/` (`index.tsx` + `<name>.css`) and is exported from `components/ui/index.ts`. States always include **default, hover, focus-visible, active/pressed, disabled**, and where relevant **loading, invalid, read-only, selected**. Focus is always the global ring (§12.1).

### 8.1 App shell (`components/shell/AppShell`)

Layout: CSS grid `grid-template-columns: var(--sidebar-width) 1fr; grid-template-rows: var(--topbar-height) 1fr`. Sidebar spans both rows; top bar sits over the content column. Content area scrolls; sidebar and top bar are fixed.

**Sidebar (navy, collapsible)**
- Width 248 px expanded, 64 px rail collapsed (state stored per user per browser under `pcp.ui.sidebarCollapsed`). Background `--color-nav-bg`. Transition width `--duration-base`.
- **Brand block** (height 56, aligned with the top bar): product mark 24 px (§9) + wordmark "PMO Capacity Planner" 14/20/600 `--color-nav-text-active`; collapsed: mark only, centred, with Tooltip.
- **Groups** (in order): (no heading) Home, My plan (Contributors/linked people only); **Plan**: Capacity Outlook, Demand, Allocations, Marketplace; **Organisation**: People, Projects, Tribes; **Delivery**: Jira & Planview, Sprint planning (flag); **Reports**: Reports. **Bottom group** (pinned, divider `--color-nav-border` above): Settings, then the collapse toggle (`PanelLeftClose` / `PanelLeftOpen`, `aria-label` "Collapse sidebar"/"Expand sidebar").
- Group heading: `overline` style, `--color-nav-muted`, padding `16px 16px 4px`; hidden in the rail (replaced by an 8 px gap).
- Item: height 36, margin `0 8px`, padding `0 12px`, radius `--radius-sm`, icon 16 + gap 12 + label 14/20/500, colour `--color-nav-text`. Hover: background `--color-nav-hover`, label `--color-nav-text-active`. Active: background `--color-nav-active`, label white, icon `--color-nav-accent`, 3 px bar `--color-nav-accent` on the left edge (inside the item, full height, radius 0 3 3 0), `aria-current="page"`. Rail: item 40×36 centred icon; label in a right Tooltip.
- `<nav aria-label="Primary">` with a `<ul>` per group (`aria-labelledby` the heading).
- Below 1280 px the sidebar starts collapsed; below 768 px it is hidden and opens as an overlay drawer (left, 280 px, scrim, focus trap) from the top bar Menu button.

**Top bar** (height 56, `--color-surface`, bottom border 1 px `--color-border`, padding `0 var(--page-gutter)`, `<header>`):
- Left: (mobile) `Menu` icon button; **Workspace switcher**: subtle button "{Org} › {Workspace}" (org 14/20/400 `--color-text-secondary`, workspace 14/20/600) + `ChevronsUpDown` 16; opens a Menu listing workspaces (name + role caption), selected item with `Check`.
- Centre-left: **Search** field 320 px (240 at 1024–1279, icon-only below 1024): sunken background, `Search` icon 16, placeholder "Search people, projects, crafts", trailing `Kbd` "⌘K" / "Ctrl K". Opens the search dialog (560 px, top 15 vh).
- Right (gap 8): **Plan context** neutral lozenge "LIVE" (becomes a Menu "Live ▾ / Scenario" when SC ships); **Help** icon button `CircleQuestionMark` (menu: Glossary, Keyboard shortcuts, What's new · v2.0.0, Ask the assistant when AI is enabled); **Notifications** icon button `Bell` with count badge (§8.9); **User menu**: Avatar 28 + chevron; menu: name and email header, Profile, Sign out.
- Embedded mode (`data-embedded` or `?embedded=1`): sidebar and top bar not rendered; page header shows the area's views as underline Tabs; page gutter 16.

### 8.2 Page header (`PageHeader`)

- Padding `24px var(--page-gutter) 16px`; background transparent (on `--color-bg`).
- Row 1: **Breadcrumbs** caption 12/16 `--color-text-secondary`, separators `ChevronRight` 12, last crumb not a link, `<nav aria-label="Breadcrumb">`.
- Row 2: **H1** (24/32/600) left; **actions** right, gap 8, never wrapping: at most one primary Button, then secondary Buttons, then an overflow IconButton `Ellipsis` ("More actions") holding Export/Import and rarely used actions. If space runs out, secondary actions move into the overflow menu (priority order defined per page).
- Row 3 (optional): one-line description 14/20 `--color-text-secondary`, single line with ellipsis (full text in Tooltip); and, right-aligned on the same row, the **time-basis** SegmentedControl "Today · QBR1 · QBR2 · QBR3 · QBR4 · Window" (sm size).
- Row 4 (optional): page Tabs (underline) with a 1 px bottom border.

### 8.3 Buttons (`Button`, `IconButton`, `ButtonGroup`)

| Size | Height | Horizontal padding | Font | Icon | Icon-only size |
|---|---|---|---|---|---|
| `sm` | 28 | 8 | 13/18/500 | 16 | 28×28 |
| `md` (default) | 32 | 12 | 14/20/500 | 16 | 32×32 |
| `lg` | 40 | 16 | 14/20/600 | 20 | 40×40 |

| Variant | Default | Hover | Pressed | Disabled |
|---|---|---|---|---|
| `primary` | bg `--color-primary`, text `--color-on-primary` | `--color-primary-hover` | `--color-primary-pressed` | bg `--color-surface-sunken`, text `--color-text-disabled` |
| `secondary` | bg `--color-surface`, 1 px `--color-border-strong`, text `--color-text` | bg `--color-surface-hover`, border `--color-border-input` | bg `--color-surface-sunken` | text `--color-text-disabled`, border `--color-border` |
| `subtle` | transparent, text `--color-text-secondary` | bg `--color-surface-hover`, text `--color-text` | bg `--color-surface-sunken` | text `--color-text-disabled` |
| `danger` | bg `--color-danger-fill`, text `--color-on-primary` | `--color-danger-hover` | `--color-danger-pressed` | as primary disabled |
| `link` | transparent, text `--color-link`, no padding | underline, `--color-link-hover` | — | `--color-text-disabled` |

Radius `--radius-sm`; icon gap 8; transitions `--duration-fast`. `loading`: spinner replaces the leading icon, label kept, `aria-busy="true"`, clicks ignored. Icon-only buttons require `aria-label` and show a Tooltip with the same text. One primary button per view region. Destructive confirmation buttons use `danger`; destructive menu items use danger text. Button labels are verbs in sentence case ("Add person", "Propose", "Sync now"), never "OK"/"Yes".

### 8.4 Form controls

Common: wrapped by `FormField` (label 12/16/600 `--color-text-secondary` above the control, gap 4; optional "(optional)" suffix in tertiary; help text caption tertiary below; error caption `--color-danger` with `CircleAlert` 12 below, linked via `aria-describedby`; `aria-invalid="true"`). Height 32 (`sm` 28, `lg` 40 on sign-in). Border 1 px `--color-border-input`, radius `--radius-sm`, background `--color-surface`, text 14/20 `--color-text`, placeholder `--color-text-tertiary`, padding `0 8px`.

| State | Treatment |
|---|---|
| hover | border `--color-border-input-hover` |
| focus | border `--color-primary` + focus ring |
| invalid | border `--color-danger`, error text below |
| disabled | bg `--color-surface-sunken`, text `--color-text-disabled`, border `--color-border` |
| read-only | bg `--color-surface-sunken`, border `--color-border`, text `--color-text` (selectable) |

- **TextField**: optional leading icon (16, tertiary) and trailing clear button `X` (`aria-label="Clear"`).
- **NumberField**: right-aligned, `tabular-nums`, unit suffix inside the right edge in tertiary ("%", "FTE"), step buttons hidden; arrow up/down change by `step` (1 for %, 0.1 for FTE); min/max enforced on blur with an inline error ("Enter 0–200").
- **Select**: native `<select>` styled with `appearance: none` and a `ChevronDown` 16 at the right (for short static lists).
- **Combobox** (people, projects, crafts, tribes): input with listbox popover (`--elevation-2`, radius 8, max-height 320, options 32 high with optional Avatar/CraftChip, highlighted option `--color-primary-subtle`, group headings `overline`); `role="combobox"`, `aria-expanded`, `aria-activedescendant`; "No matches" in tertiary; type-ahead filtering.
- **DateField**: native `type="date"` styled like TextField with a `CalendarDays` icon; displays `d MMM yyyy` in read-only contexts.
- **QuarterPicker**: Select/Menu of the four rolling quarters ("QBR1 · Q4 2026") plus "Window".
- **Checkbox**: 16×16, radius 3, border `--color-border-input`; checked/indeterminate fill `--color-primary` with white `Check`/`Minus` 12. **Radio**: 16 px circle, 6 px inner dot. Label 14/20 to the right, gap 8, the whole row clickable.
- **Switch**: track 32×18 radius full; off `--color-border-strong`, on `--color-primary`; knob 14 white with `--elevation-1`; `role="switch"`, `aria-checked`; label to the right; state text not required.

### 8.5 Tabs (`Tabs`)

One style app-wide: **underline**. Height 40, gap 24 between tabs, label 14/20/500 `--color-text-secondary`; hover `--color-text`; selected `--color-text` with a 2 px `--color-primary` bar on the bottom edge (overlapping the 1 px container border `--color-border`). Optional count badge after the label. `role="tablist"`/`tab`/`tabpanel`, arrow keys move, Home/End jump; selected tab reflected in the URL (`?tab=`).

### 8.6 Segmented control (`SegmentedControl`)

Track `--color-surface-sunken`, radius 4, padding 2; segments height 28 (sm 24), padding `0 12px`, label 13/18/500 `--color-text-secondary`; selected segment background `--color-surface`, `--elevation-1`, label `--color-text`. Used for exclusive view switches (Chart | Table, By person | By project, Compact | Comfortable, time basis). `role="radiogroup"` with `role="radio"` segments.

### 8.7 Badges, lozenges, pills and chips

| Component | Spec |
|---|---|
| **StatusPill** (lozenge) | Height 20, padding `0 6px`, radius `--radius-xs`, `overline` text (11/16/600 uppercase), optional 12 px icon; variants `neutral` (chip-bg / text-secondary), `info`, `success`, `warning`, `danger`, `brand` (primary-subtle / primary) using `-bg` and text tokens. Examples: "SUCCEEDED", "STALE", "TENTATIVE", "CONFIRMED", "FORECAST", "ARCHIVED". |
| **BandPill** | A StatusPill bound to `UtilBand`: icon from §2.4 + label from `BAND_LABEL` (rendered uppercase), colours from band tokens. Optional value prefix ("112% · OVER CAPACITY"). |
| **Band cell tint** (tables/grid) | Cell background `--band-*-bg`, value text `--band-*-fg` 13/18/600 `tnum`, right-aligned; `over` and `under` also show their 12 px icon before the value; the band label is in the cell's Tooltip and `aria-label` ("112%, Over capacity"). |
| **CraftChip** | Height 20, padding `0 6px`, radius `--radius-xs`, text `caption-strong` (12/16/600) short code. **Above the table** (`via="primary"`): filled `--color-chip-bg`, text `--color-text`. **Below the table** (`via="secondary"`): transparent, 1 px `--color-border-input` border, text `--color-text-secondary`, suffix "·L{n}" (e.g. "SM·L3"). **Undeclared** craft on a booking: dashed 1 px border. Tooltip: "{Craft name} · above the table" / "below the table · L3 can own independently · up to 50%". Never status or series colours. |
| **ProvenanceTag** | Inline icon 12 + caption 12/16/500 `--color-text-secondary`, no background: Manual `PencilLine`, Marketplace `Store`, Jira `SquareKanban`, Planview `CalendarRange` (Planview-sourced rows also get an `info` tint only where the lock applies). |
| **Count badge** | Min-width 16, height 16, radius full, 11/16/600, white on `--color-danger-fill` (notifications) or `--color-primary-subtle` / `--color-primary` (tab counts). Shows "99+" above 99. |
| **Tag** (skills) | Like a neutral StatusPill but sentence case 12/16/500, removable with `X` 12 in editors. |

### 8.8 KPI tile (`KpiTile`)

Card (`--color-surface`, 1 px border, radius 6, padding 16). Content top to bottom: **label** `caption-strong` `--color-text-secondary` (sentence case, e.g. "Squad utilisation"); **value** `kpi-value` (28/36/600, `tnum`) with an optional BandPill to the right; **delta** caption: `ArrowUpRight`/`ArrowDownRight` 12 + text "+6 pts vs QBR2" in `--color-text-secondary` (direction icon only; never red/green for deltas unless the delta itself is a status); **time-basis caption** caption `--color-text-tertiary` ("QBR1 · Q4 2026"); optional **sparkline** 24 px high using `--chart-1`, no axes. Optional help `CircleQuestionMark` 14 IconButton linking to the glossary. Grid: 4 per row ≥ 1024 px (gap 16), 2 per row 640–1023, 1 below; never an orphan (pages supply 4 or 8 tiles). No icons-in-blobs, no decorative circles.

### 8.9 Data table (`DataTable`)

- Container: Card with radius 6 and 1 px border; the table scrolls horizontally **inside** the card (`overflow: auto`); the page never scrolls horizontally.
- Header row: height 36, background `--color-surface-sunken`, label `caption-strong` `--color-text-secondary`, bottom border `--color-border`; **sticky** (`top: 0`, `--z-sticky`); shows `--elevation-1` once the body scrolls.
- **First column sticky** (`left: 0`) with a 1 px right border `--color-border` and `--elevation-1` when horizontally scrolled; top-left cell `--z-sticky-corner`.
- Rows: **compact** 32 px (default for grids) or **comfortable** 40 px (default for lists), cell padding `0 12px` (comfortable `8px 12px`), text `table` 13/18, bottom border `--color-border`; hover `--color-surface-hover`; selected `--color-primary-subtle` with a checkbox column (40 px) at the left.
- Numeric columns right-aligned with `tnum`; text left; status centred only for single icons.
- **Sort**: clickable header (`<button>` inside `<th>`), icon `ArrowUp`/`ArrowDown` 12 when sorted, `ArrowUpDown` 12 in tertiary on hover; `aria-sort`.
- **Filter chips** above the table (secondary sm Buttons with `Funnel` and the active value, removable), search TextField, "Group by" Select, column visibility Menu (`Columns3`), density SegmentedControl (`Rows3`).
- **Bulk-action bar**: replaces the filter row when rows are selected: background `--color-primary-subtle`, text "{n} selected" 14/20/600 `--color-primary`, actions as sm secondary Buttons, "Clear" link; `--z-page-header`.
- **Group rows**: background `--color-surface-sunken`, `body-strong` label, `ChevronDown`/`ChevronRight` toggle, group totals in the same columns.
- **States**: loading = 5 skeleton rows; empty = EmptyState inside the card; error = danger Banner inside the card with "Retry".
- **Virtualisation** above 200 rows (`@tanstack/react-virtual`), overscan 10.
- Semantics: `<table>` with `<caption>` (visually hidden if redundant), `<th scope="col">`, row headers `<th scope="row">` for the first column. The editable allocation grid instead uses `role="grid"` with roving tabindex (AL-02).

### 8.10 Quarter load bar (`QuarterLoadBar`) and heat strip (`HeatStrip`)

- **QuarterLoadBar**: horizontal stacked bar, height 8 (tables) or 12 (drawer), track `--color-surface-sunken`, radius `--radius-xs`. Scale 0–125 % of the person's target. Segments in this order with a 2 px `--color-surface` gap between them: above-the-table `--chart-1`, below-the-table `--chart-2`, undeclared `--chart-3`, free capacity `--chart-bench` with 45° hatch (`--chart-bench-hatch`, `repeating-linear-gradient` defined in CSS). A 2 px dashed `--chart-target` tick marks 100 % of target. Load above 125 % clips and shows a `--color-danger` 2 px cap at the right end. Always accompanied by a text label ("112% of 100%") to the right or in the Tooltip; `role="img"` with `aria-label` "QBR1: 60% above the table, 30% below, 0% undeclared, 10% free".
- **HeatStrip**: four cells (QBR1–4) 48×24 each, gap 2, radius 3, band cell tint with the % value 12/16/600 `tnum`; column header labels "QBR1…QBR4" in caption above the first row of a table.

### 8.11 Drawer (`Drawer`)

Right side, width `--drawer-sm` 480 or `--drawer-lg` 720 (100 % below 768), full height, background `--color-surface`, radius `8px 0 0 8px`, `--elevation-3`, scrim `--color-scrim` (click closes unless dirty). Header: height 56, padding `0 24px`, title H3, optional subtitle caption, tabs below the header if any, close IconButton `X` ("Close"). Body scrolls, padding 24. Footer (when editing): sticky, height 64, top border, actions right-aligned (secondary "Cancel" then primary "Save"). Enter animation translateX(100 % → 0) `--duration-base`. Focus trap; Escape closes (asks to discard when dirty); focus returns to the opener; URL param reflects it (`?person=`).

### 8.12 Dialog / modal (`Dialog`, `ConfirmDialog`)

**There are no `window.alert`, `window.confirm` or `window.prompt` calls in the product.** All confirmations, errors that need acknowledgement and short forms use Dialog.
- Widths: `--dialog-sm` 400 (confirm), `--dialog-md` 560 (forms), `--dialog-lg` 800 (review screens), max-height 85 vh with body scroll. Radius 8, `--elevation-3`, background `--color-surface-raised`, scrim `--color-scrim`.
- Header padding `24px 24px 0`, title H2 (20/28/600); close `X` IconButton top-right (omitted on confirm dialogs). Body padding 24, text 14/20. Footer padding `0 24px 24px`, actions right-aligned, gap 8, primary/danger rightmost.
- `role="dialog"` (`role="alertdialog"` for confirmations), `aria-modal="true"`, `aria-labelledby` (title), `aria-describedby` (body); focus moves to the first focusable element (confirm dialogs: the **Cancel** button), trap, Escape closes (not for in-progress saves), focus restored.
- **ConfirmDialog copy pattern**: title states the action and object ("Delete Maria Kelly?"); body states the consequence in one or two sentences ("Her 3 bookings will also be deleted. You can undo this for 8 seconds."); buttons "Cancel" and the verb ("Delete"). Never "Are you sure?" or "OK".
- Promise API: `const ok = await confirm({ title, body, confirmLabel, tone: 'danger' | 'primary' })`.

### 8.13 Toast (`Toast`, `useToast`)

Bottom-left stack, 24 px from the edges (above the sidebar edge: offset by sidebar width), width 360, max 3 visible (oldest dismissed first). Card `--color-surface-raised`, radius 6, `--elevation-2`, 4 px left border in the status colour, status icon 16 (`CircleCheck` success, `Info` info, `TriangleAlert` warning, `CircleAlert` error), title 14/20/600, optional body 13/18 secondary, optional action link button ("Undo", "View"), close `X`. Durations: success/info 5 s, with an action 8 s, error persistent until closed; hover pauses the timer. Success/info `role="status"` (polite), error `role="alert"`. Error copy never exposes raw server text; include the reference: "Something went wrong. Try again, or quote reference {requestId}."

### 8.14 Banner (`Banner`)

Page- or card-level message: full width of the content area, radius 6, padding `12px 16px`, background `--color-X-bg`, 1 px `--color-X-border`, icon 16 in `--color-X`, text 14/20 `--color-text`, optional single action (link button) and optional dismiss. Variants info, success, warning, danger, neutral. Examples: demo mode (neutral), sync failed (danger), scenario context (warning, SC), "3 craft changes waiting for approval" (info). Max one page-level banner at a time (highest severity wins).

### 8.15 Empty state (`EmptyState`)

Centred block, padding 48, max-width 420. Lucide icon 32 (stroke 1.5) in `--color-text-tertiary`; title 16/24/600 `--color-text`; one sentence 14/20 `--color-text-secondary`; one primary Button (optional secondary link). Example: `Users` · "No people yet" · "Add your squad to start planning capacity." · "Add person". Filtered-empty variant uses the `Funnel` icon, "No people match these filters." and a "Clear filters" link. No emoji, no illustrations.

### 8.16 Skeleton (`Skeleton`) and spinner (`Spinner`)

Skeleton blocks `--color-skeleton`, radius `--radius-sm`, shimmer gradient to `--color-skeleton-shine` 1.2 s (off with reduced motion). Presets: `text` (12 px high lines, widths 100/80/60 %), `kpi` (tile shape), `table` (header + 5 rows matching density), `chart` (block with 4 bars). `aria-busy="true"` on the region and a visually hidden "Loading {thing}". Spinner (`LoaderCircle` rotating, 16/20) only inside buttons and small inline loads; pages use skeletons.

### 8.17 Tooltip (`Tooltip`)

Background `--color-tooltip-bg`, text `--color-tooltip-text` 12/16, padding `4px 8px`, radius `--radius-sm`, `--elevation-2`, max-width 280, 8 px offset, placement auto (top preferred). Opens on hover after 300 ms and immediately on keyboard focus; closes on Escape, blur or pointer leave. `role="tooltip"`, trigger has `aria-describedby`. Never put interactive content or essential-only information in a tooltip (essential info must also be on screen or in `aria-label`).

### 8.18 Avatar (`Avatar`)

Sizes 24 (tables), 28 (top bar), 32 (lists), 40 (drawer header). Radius full. Initials (first + last, uppercase) `caption-strong` (size 24 → 10/12, 32 → 12/16, 40 → 14/20) in `--color-primary` on `--color-primary-subtle`. Image (Atlassian avatar when linked) with `alt` = name; on error falls back to initials. Avatars carry no status colour; an optional 8 px status dot (with text equivalent elsewhere) is allowed only for "linked to Jira" (`--color-info`).

### 8.19 Menu (`Menu`)

Trigger: Button or IconButton (`Ellipsis` for overflow). Popover `--color-surface-raised`, radius 8, `--elevation-2`, padding 4, min-width 180. Items height 32, padding `0 12px`, radius 4, icon 16 + label 14/20, shortcut hint right in tertiary; hover/active `--color-surface-hover`; destructive items `--color-danger` text and icon, separated by a divider. `role="menu"`/`menuitem`, arrow keys, Home/End, type-ahead, Escape returns focus to the trigger.

### 8.20 Card (`Card`)

`--color-surface`, 1 px `--color-border`, radius 6, padding 24 (16 when `dense`). Optional header: title H3 + right-aligned actions (subtle sm buttons), 16 px below. Cards never nest more than one level and never carry shadows unless interactive (hover `--elevation-1`).

### 8.21 Kbd (`Kbd`)

Inline 11/16/500 monospace, padding `0 4px`, radius 3, background `--color-surface-sunken`, 1 px `--color-border`, text `--color-text-secondary`.

---

## 9. Brand: wordmark and product mark

- Name: **PMO Capacity Planner** (never "Orbit", "Orbit Space", "PMO Planner"). In Release 3.0 listings: "PMO Capacity Planner for Jira".
- **Mark**: 24×24 rounded square (radius 6) filled `--color-primary` with three white horizontal bars of increasing length (capacity bars), left-aligned. Favicon `public/favicon.svg` uses the same SVG with the literal hex (favicons cannot read CSS variables):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="PMO Capacity Planner">
  <rect width="24" height="24" rx="6" fill="#1F5FCC"/>
  <rect x="5" y="6.5" width="8" height="2.5" rx="1.25" fill="#FFFFFF"/>
  <rect x="5" y="10.75" width="11" height="2.5" rx="1.25" fill="#FFFFFF"/>
  <rect x="5" y="15" width="14" height="2.5" rx="1.25" fill="#FFFFFF"/>
</svg>
```

- **Wordmark**: mark + 8 px gap + "PMO Capacity Planner" in Inter 600 (14/20 in the sidebar, 20/28 on the sign-in card). On navy, the text is white; on light surfaces, `--color-text`. No taglines in the chrome.
- In React the mark is `components/shell/ProductMark.tsx` using `fill="currentColor"`-style classes bound to tokens (the favicon file is the only literal-hex copy, exempt from DS-07).

---

## 10. Icons

`lucide-react` only (v0.570 installed; use the **canonical** export names below, not deprecated aliases). Size 16 in nav, tables, buttons and menus; 20 in page headers and empty-state actions; 12 inside chips, pills and table headers; 32 in empty states. `strokeWidth={1.75}` (1.5 at 32 px). Colour `currentColor`. Decorative icons next to text get `aria-hidden="true"`; icon-only controls get `aria-label` plus a Tooltip.

**Navigation**

| Item | Icon |
|---|---|
| Home | `LayoutDashboard` |
| My plan | `CircleUserRound` |
| Capacity Outlook | `Gauge` |
| Demand | `Map` |
| Allocations | `Grid3x3` |
| Marketplace | `Store` |
| People | `Users` |
| Projects | `FolderKanban` |
| Tribes | `Network` |
| Jira & Planview (Delivery) | `Activity` |
| Sprint planning (flag) | `CalendarDays` |
| Reports | `FileChartColumn` |
| Settings | `Settings` |
| Collapse / expand sidebar | `PanelLeftClose` / `PanelLeftOpen` |
| Mobile menu | `Menu` |

**Settings sections**: Profile `CircleUserRound`, Organisation `Building2`, Members and roles `UserPlus`, Structure `Network`, Crafts `Layers`, Planning `SlidersHorizontal`, Integrations `Plug`, Features `ToggleRight`, Billing `BadgeCheck`, Audit log `History`.

**Top bar and common actions**

| Action / meaning | Icon |
|---|---|
| Workspace switcher | `ChevronsUpDown` |
| Search | `Search` (shortcut hint `Command` not needed; use `Kbd`) |
| Help | `CircleQuestionMark` |
| Notifications | `Bell` |
| Sign out | `LogOut` |
| Add / create | `Plus` |
| Edit | `Pencil` |
| Delete | `Trash2` |
| More actions (overflow) | `Ellipsis` |
| Export / download | `Download` |
| Import / upload | `Upload` |
| Copy / copy link | `Copy` / `Link` |
| External link | `ExternalLink` |
| Sync now / refresh | `RefreshCw` |
| Undo | `Undo2` |
| Filter | `Funnel` |
| Columns / density | `Columns3` / `Rows3` |
| Close / remove / clear | `X` |
| Confirm / selected | `Check` |
| Propose (Marketplace) | `Send` |
| Copy to later quarters | `Copy` (label "Copy to later quarters") |
| Compare (scenario) | `GitCompareArrows` |
| Scenario | `GitBranch` |
| Locked (Planview rule) | `Lock` |
| Partial quarter | `CalendarRange` |
| Sort | `ArrowUp` / `ArrowDown` / `ArrowUpDown` |
| Delta up / down | `ArrowUpRight` / `ArrowDownRight` |
| Expand / collapse group | `ChevronRight` / `ChevronDown` |
| Show / hide secret | `Eye` / `EyeOff` |
| Email | `Mail` |
| 2FA / security | `ShieldCheck` / `KeyRound` |
| AI assistant | `Sparkles` |
| Approvals / requests | `ListChecks` |
| Inbox (notifications list) | `Inbox` |
| Time to staff / SLA | `Hourglass` |
| Target | `Target` |
| Loading | `LoaderCircle` |
| Table view toggle | `Table2` |
| Chart view toggle | `ChartColumnStacked` |
| Skills | `Tag` |

**Status icons**: success `CircleCheck`, warning `TriangleAlert`, danger/error `CircleAlert`, info `Info`, failed job `CircleX`, running `LoaderCircle`, queued `CircleDashed`, bench `Circle`, under target `CircleArrowDown`, on target `CircleCheck`, over capacity `TriangleAlert`. **Provenance**: Manual `PencilLine`, Marketplace `Store`, Jira `SquareKanban`, Planview `CalendarRange`.

---

## 11. Charts

Recharts, wrapped by `components/ui/charts/*`. Colours are read from CSS variables at render time (`getComputedStyle(document.documentElement).getPropertyValue('--chart-1')`), never hard-coded.

### 11.1 Categorical series (identity), fixed order, never cycled

| Slot | Token | Light | Dark | Fixed meaning where applicable |
|---|---|---|---|---|
| 1 | `--chart-1` | `#1F5FCC` blue | `#4C82EB` | Above-the-table load; planned FTE |
| 2 | `--chart-2` | `#00897A` teal | `#00998A` | Below-the-table load; Jira-implied FTE |
| 3 | `--chart-3` | `#C77A12` amber | `#C07F22` | Undeclared craft load |
| 4 | `--chart-4` | `#6E56CF` violet | `#8A76E3` | Demand / requested |
| 5 | `--chart-5` | `#C2417A` magenta | `#D45F90` | — |
| 6 | `--chart-6` | `#4E7F2A` olive | `#5C9636` | — |
| 7 | `--chart-7` | `#2E93D1` sky | `#3A98D8` | — |
| 8 | `--chart-8` | `#9A5B2E` sienna | `#BE6E38` | — |

**Reserved neutrals (not identity slots):**

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--chart-other` | `#5C6B82` slate | `#8C9AB0` | "Other" / unmapped (a 9th+ series folds here) |
| `--chart-target` | `#0B1F3A` navy | `#E6EBF2` | Totals and target line (2 px dashed `4 4`) |
| `--chart-bench` | `#E3E8EF` | `#2A3447` | Free / bench capacity fill |
| `--chart-bench-hatch` | `#B8C3D2` | `#3A465C` | 45° hatch lines over bench (1 px every 6 px) |
| `--chart-grid` | `#E3E8EF` | `#2A3447` | Gridlines (horizontal only, 1 px) |
| `--chart-axis` | `#5E6C84` | `#8D9AB0` | Axis labels and ticks (12/16 tnum) |

**Validation results** (validator: OKLab ΔE ×100, Machado 2009 protan/deutan at severity 1.0, adjacent pairs, surfaces `#FFFFFF`/`#F4F6F9` light and `#141C2B` dark):
- Light: lightness band PASS, chroma ≥ 0.10 PASS, worst adjacent CVD pair olive↔magenta ΔE 8.8 (deutan) PASS (target ≥ 8), normal-vision worst pair teal↔blue ΔE 19.7 PASS (≥ 15), all slots ≥ 3:1 on white and on `#F4F6F9` PASS.
- Dark: lightness band PASS, chroma PASS, worst CVD olive↔magenta ΔE 9.8 PASS, normal-vision worst magenta↔violet ΔE 17.3 PASS, contrast ≥ 3:1 on `#141C2B` PASS.
- The palette is validated for **adjacent** use (stacked bars, grouped bars, lines). For scatter/bubble/small-multiples where any two series can touch, use at most slots 1–3 or facet.

**Text contrast notes**: series colours are for marks only. Labels, values and legends use text tokens (`--color-text`, `--color-text-secondary`), never the series colour. If a value must be printed **inside** a filled segment (light theme, measured): white (`--color-on-primary`) passes 4.5:1 on slots 1 (5.89), 4 (5.39), 5 (4.85), 6 (4.78) and 8 (5.37); `--color-text` passes on slots 3 (4.67) and 7 (4.66); **slot 2 (teal) passes neither** (white 4.32, text 3.64), so teal segments never carry inside labels. Inside labels also require the segment to be at least 24 px tall and wide enough for the text; otherwise the label goes outside the mark or into the tooltip/table view.

### 11.2 Sequential and diverging

- **Sequential** (heat strips by magnitude, e.g. FTE density): single blue ramp `#EBF2FD → #B7CDF3 → #6F9BE6 → #1F5FCC → #123F8A` (light) / `#1A2C4D → #2F4C7E → #3B6FD0 → #6F9BE6 → #A3C2F8` (dark). Utilisation heat strips do **not** use this ramp: they use band tokens (status).
- **Diverging** (planned vs implied FTE delta): `--chart-2` teal (Jira higher) ↔ neutral `#E3E8EF` midpoint ↔ `--chart-4` violet (plan higher). Never red/green for this (it is not good/bad).

### 11.3 Mark specs

Bars: max thickness 32, 2 px `--color-surface` gap between stacked segments and between adjacent bars, 4 px rounded data-end on the outer end only. Lines: 2 px, markers 8 px on hover only (always for ≤ 6 points). Gridlines horizontal only, `--chart-grid`; no chart borders or backgrounds; y-axis starts at 0 for bars. One y-axis per chart (no dual axes). Units in axis titles ("FTE", "%").

### 11.4 Chart anatomy and interaction

`ChartFrame`: title `h3`, time-basis caption, legend (always for ≥ 2 series; ≤ 4 series also direct-labelled), SegmentedControl "Chart | Table" (table view required for every chart), optional Export. Tooltip on hover **and** keyboard focus of each bar/point: series name, value with unit, quarter label and basis; crosshair on line charts. Hit targets ≥ 24 px. Charts have `role="img"` with an `aria-label` summary, and the table view is the accessible equivalent.

### 11.5 PDF palette (QBR pack, `utils/pdfExport.ts`)

jsPDF cannot read CSS variables, so the PDF uses this fixed light palette (the only other place hex is allowed): text `#14233B`, secondary `#44546F`, tertiary `#5E6C84`, border `#DCE2EA`, header fill `#EEF1F6`, primary `#1F5FCC`, series 1–8 as §11.1 light, target `#0B1F3A`, bench `#E3E8EF`, bands as §2.4 (fg/bg pairs). Font: Helvetica in the PDF (Inter embedding is optional); sizes 9/11/14/18 pt for caption/body/h3/h1.

---

## 12. Accessibility rules (WCAG 2.1 AA)

### 12.1 Focus

- Global rule: `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }` on every interactive element; inside tables and the grid, offset `-2px` (inset) so the ring isn't clipped. Never `outline: none` without this replacement.
- Focus order follows visual order; no positive `tabindex`.
- A "Skip to content" link is the first focusable element and targets `<main id="main" tabindex="-1">`.
- Dialogs and drawers trap focus and restore it on close; menus and comboboxes return focus to their trigger.

### 12.2 Contrast

- Text ≥ 4.5:1 against its actual background (≥ 3:1 for text ≥ 18.66 px bold or ≥ 24 px). UI component boundaries, focus rings, icons that convey meaning and chart marks ≥ 3:1. The verified pairs are in §2; any new pair must be checked before use.
- Never use `--color-text-disabled` for anything but disabled controls. Never put tertiary text on `--color-chip-bg` or status backgrounds (use secondary).

### 12.3 Colour is never the only signal

Utilisation bands carry icon + label (or label in `aria-label` for compact cells); tentative bookings carry a dashed outline **and** the "TENTATIVE" lozenge in lists; provenance carries an icon + text; errors carry an icon + message; chart series carry legends/direct labels and the table view.

### 12.4 Keyboard

Every action is reachable by keyboard. Standard patterns: Tabs/SegmentedControl/RadioGroup (arrows), Menu (arrows, Home/End, type-ahead, Escape), Combobox (arrows, Enter, Escape), DataTable sortable headers (Enter/Space), Allocation grid (`role="grid"`, roving tabindex, arrows to move, Enter to edit, Escape to cancel, Tab/Shift+Tab to move horizontally, Ctrl/⌘ Z undo). Global shortcuts: ⌘K/Ctrl K search, `?` opens the keyboard-shortcuts dialog; shortcuts are disabled while typing in inputs.

### 12.5 Semantics and ARIA

- Landmarks: one `<header>` (top bar), `<nav aria-label="Primary">`, `<main id="main">`; drawers and dialogs per §8.11–8.12.
- Tables: semantic `<table>`, `<caption>`, `<th scope>`, `aria-sort`; grids: `role="grid"`, `aria-rowcount`, `aria-colcount`, `aria-rowindex`, `aria-colindex`, `aria-readonly` for locked cells, `aria-label` on each cell ("Noma Odigie, Phoenix Mobile, QBR1, 35%, scrum master").
- Forms: every control has a visible label bound with `for`/`id`; errors via `aria-describedby` + `aria-invalid`; required fields marked in text ("required" via `aria-required` and the absence of "(optional)").
- Live regions: toasts (`status`/`alert`); save state "Saving…/Saved" in a polite region; sync progress polite.
- Clickable elements are `<button>` or `<a>`; no `onClick` on `div`/`span`/`td` without role, tabindex and key handling (lint: `jsx-a11y`).
- Images and icon-only buttons have text alternatives; decorative icons `aria-hidden`.
- Respect `prefers-reduced-motion` (§7) and support 200 % zoom without loss of content (reflow at 320 CSS px for read-only pages).

### 12.6 Verification

axe (via `@axe-core/playwright`, tags `wcag2a`, `wcag2aa`) on every route: 0 serious/critical. Lighthouse accessibility ≥ 95 on Home, Allocations, People, Settings › Members. Manual keyboard pass for the eight PO journeys.

---

## 13. Layout grid and breakpoints

| Token | Width | Behaviour |
|---|---|---|
| `xs` | < 640 | Read-only. Sidebar hidden (overlay from Menu), top bar: Menu, title, avatar. KPI tiles 1 per row. Tables scroll in card. Page gutter 16. Edit controls hidden. |
| `sm` | 640–767 | As `xs`, KPI tiles 2 per row. |
| `md` | 768–1023 | Read-only responsive. Sidebar collapsed rail (64), search icon-only, KPI 2 per row, drawers full width. |
| `lg` | 1024–1279 | Full editing. Sidebar collapsed by default (user can expand). KPI 4 per row. |
| `xl` | 1280–1439 | Sidebar expanded. People table shows QBR1–4 without horizontal scroll (Chapter/Team collapse under name). |
| `2xl` | ≥ 1440 | Reference design width (1440×900). All People columns visible. |

CSS: `@media (min-width: 640px | 768px | 1024px | 1280px | 1440px)` (mobile-first). Custom properties cannot be used in media queries, so the values are documented here and repeated as literals only in `styles/base.css`.

Content layout: the content column is fluid (no max-width for tables and grids). Inside pages use a 12-column CSS grid with 24 px gap (16 below 1024); form pages and settings sections cap the form column at 720 px. Cards stack with 24 px vertical gap. Page gutter `--page-gutter`. Dense planning pages (Allocations, Demand) may use full width with 16 px gutters.

---

## 14. Do and don't

| Do | Don't |
|---|---|
| Use `var(--color-…)` tokens in component CSS | Hard-code hex, `rgb()`, `hsl()` or named colours in components or pages |
| Style with `pcp-` classes in the component's CSS file | Use inline `style={{ color, background, borderColor, fill, stroke }}` for theme colours |
| Use lucide icons with `aria-hidden` next to labels | Use emoji anywhere (nav, buttons, empty states, toasts, PDFs, emails) |
| Use `ConfirmDialog`, `Dialog`, `Toast`, `Banner` | Call `alert()`, `confirm()`, `prompt()` |
| Use status colours only for state (band, sync, approval, destructive) | Colour projects, crafts or tribes with status or series colours; tint cells by project colour |
| Show crafts as neutral CraftChips (filled = above, outlined = below, ·L1–3) | Use the old 12 saturated craft colours |
| State the time basis on every metric ("QBR1 · Q4 2026", "Today") | Show a number without saying when it applies |
| Right-align numbers with `tabular-nums` | Centre numeric columns or mix decimal precision |
| One primary button per region; overflow menu for Export/Import | Repeat "+ Resource / + Project / What-If" on every page |
| Use underline Tabs app-wide | Use pill tabs or three different tab styles |
| Keep chrome quiet (navy sidebar, white top bar, light page) | Gradients, glows, glass panels, decorative blobs, purple accents, 56 px hero type in the app |
| Self-host Inter via `@fontsource-variable/inter` | Load Google Fonts or any CDN asset |
| Write sentence-case, verb-first labels ("Add person", "Sync now") | Title Case Everywhere, "OK", "Yes", "Are you sure?" |
| Put errors in plain language with a reference id | Show raw API or SQL error text |
| Provide a table view for every chart | Rely on colour alone or on hover-only information |
| Keep UI preferences only in `localStorage` (`pcp.ui.*`) | Store business data, scenarios or tokens in `localStorage` |
| Use `components/ui` primitives; request a new one when needed | Build one-off styled widgets inside pages |

---

## 15. Reference implementation: `styles/tokens.css`

Package B creates this file verbatim (DS-01). It is the only stylesheet with colour literals.

```css
/* styles/tokens.css — PMO Capacity Planner design tokens (source: docs/product/DESIGN_SYSTEM.md) */
:root,
:root[data-theme="light"] {
  color-scheme: light;
  /* Brand & interaction */
  --color-primary: #1F5FCC;
  --color-primary-hover: #184EA8;
  --color-primary-pressed: #123F8A;
  --color-primary-subtle: #EBF2FD;
  --color-primary-border: #B7CDF3;
  --color-on-primary: #FFFFFF;
  --color-link: #1F5FCC;
  --color-link-hover: #184EA8;
  --color-focus: #4C8DF6;
  /* Chrome */
  --color-nav-bg: #0B1F3A;
  --color-nav-hover: #13294B;
  --color-nav-active: #1B3A66;
  --color-nav-border: #1B3A66;
  --color-nav-text: #C7D2E3;
  --color-nav-text-active: #FFFFFF;
  --color-nav-muted: #8C9DB8;
  --color-nav-accent: #6FA4FF;
  /* Surfaces */
  --color-bg: #F4F6F9;
  --color-surface: #FFFFFF;
  --color-surface-raised: #FFFFFF;
  --color-surface-sunken: #EEF1F6;
  --color-surface-hover: #F5F8FC;
  --color-chip-bg: #E3E8EF;
  --color-scrim: rgba(11, 31, 58, 0.48);
  /* Borders */
  --color-border: #DCE2EA;
  --color-border-strong: #B8C3D2;
  --color-border-input: #7D8AA0;
  --color-border-input-hover: #5E6C84;
  /* Text */
  --color-text: #14233B;
  --color-text-secondary: #44546F;
  --color-text-tertiary: #5E6C84;
  --color-text-disabled: #9AA6B8;
  --color-text-inverse: #FFFFFF;
  --color-tooltip-bg: #14233B;
  --color-tooltip-text: #FFFFFF;
  --color-skeleton: #E3E8EF;
  --color-skeleton-shine: #F4F6F9;
  /* Status */
  --color-success: #17744A; --color-success-bg: #E6F4EC; --color-success-border: #A8D5BC; --color-success-fill: #2E9E6A;
  --color-warning: #A35200; --color-warning-bg: #FFF3E0; --color-warning-border: #F5C98A; --color-warning-fill: #F5A524;
  --color-danger: #C22E2E;  --color-danger-bg: #FDECEC;  --color-danger-border: #F2B8B8;  --color-danger-fill: #C22E2E;
  --color-danger-hover: #A32424; --color-danger-pressed: #8A1E1E;
  --color-info: #0B6E8F;    --color-info-bg: #E3F3F8;    --color-info-border: #A9D8E6;    --color-info-fill: #0B6E8F;
  --color-neutral: #44546F; --color-neutral-bg: #EEF1F6; --color-neutral-border: #B8C3D2; --color-neutral-fill: #5E6C84;
  /* Utilisation bands */
  --band-bench-fg: var(--color-text-secondary);  --band-bench-bg: var(--color-surface-sunken);
  --band-under-fg: var(--color-warning);         --band-under-bg: var(--color-warning-bg);
  --band-on-target-fg: var(--color-success);     --band-on-target-bg: var(--color-success-bg);
  --band-over-fg: var(--color-danger);           --band-over-bg: var(--color-danger-bg);
  /* Charts */
  --chart-1: #1F5FCC; --chart-2: #00897A; --chart-3: #C77A12; --chart-4: #6E56CF;
  --chart-5: #C2417A; --chart-6: #4E7F2A; --chart-7: #2E93D1; --chart-8: #9A5B2E;
  --chart-other: #5C6B82; --chart-target: #0B1F3A; --chart-bench: #E3E8EF; --chart-bench-hatch: #B8C3D2;
  --chart-grid: #E3E8EF; --chart-axis: #5E6C84;
  /* Elevation */
  --elevation-0: none;
  --elevation-1: 0 1px 2px rgba(11, 31, 58, 0.08);
  --elevation-2: 0 4px 12px rgba(11, 31, 58, 0.12);
  --elevation-3: 0 12px 32px rgba(11, 31, 58, 0.18);

  /* Theme-independent tokens */
  --font-sans: 'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --text-display-size: 28px; --text-display-line: 36px; --text-display-weight: 600;
  --text-h1-size: 24px; --text-h1-line: 32px; --text-h1-weight: 600;
  --text-h2-size: 20px; --text-h2-line: 28px; --text-h2-weight: 600;
  --text-h3-size: 16px; --text-h3-line: 24px; --text-h3-weight: 600;
  --text-body-size: 14px; --text-body-line: 20px; --text-body-weight: 400;
  --text-table-size: 13px; --text-table-line: 18px;
  --text-caption-size: 12px; --text-caption-line: 16px;
  --text-overline-size: 11px; --text-overline-line: 16px; --text-overline-tracking: 0.04em;
  --text-kpi-size: 28px; --text-kpi-line: 36px;
  --space-0: 0; --space-025: 2px; --space-050: 4px; --space-075: 6px; --space-100: 8px; --space-150: 12px;
  --space-200: 16px; --space-250: 20px; --space-300: 24px; --space-400: 32px; --space-500: 40px; --space-600: 48px; --space-800: 64px;
  --radius-xs: 3px; --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-full: 9999px;
  --z-base: 0; --z-sticky: 10; --z-sticky-corner: 11; --z-page-header: 20; --z-sidebar: 100; --z-topbar: 110;
  --z-dropdown: 1000; --z-drawer: 1100; --z-modal: 1200; --z-toast: 1300; --z-tooltip: 1400; --z-skip-link: 1500;
  --duration-fast: 120ms; --duration-base: 200ms; --duration-slow: 300ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1); --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --sidebar-width: 248px; --sidebar-collapsed: 64px; --topbar-height: 56px; --page-gutter: 24px;
  --drawer-sm: 480px; --drawer-lg: 720px; --dialog-sm: 400px; --dialog-md: 560px; --dialog-lg: 800px;
  --control-height-sm: 28px; --control-height-md: 32px; --control-height-lg: 40px;
  --row-compact: 32px; --row-comfortable: 40px;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --color-primary: #2F6FDB; --color-primary-hover: #255FC4; --color-primary-pressed: #1F55B0;
  --color-primary-subtle: #1A2C4D; --color-primary-border: #2F4C7E; --color-on-primary: #FFFFFF;
  --color-link: #7EA8F5; --color-link-hover: #A3C2F8; --color-focus: #6FA4FF;
  --color-nav-bg: #0A1220; --color-nav-hover: #121C30; --color-nav-active: #1B2B47; --color-nav-border: #1B2B47;
  --color-bg: #0E1522; --color-surface: #141C2B; --color-surface-raised: #1A2436; --color-surface-sunken: #101827;
  --color-surface-hover: #1A2436; --color-chip-bg: #2A3447; --color-scrim: rgba(0, 0, 0, 0.60);
  --color-border: #2A3447; --color-border-strong: #3A465C; --color-border-input: #6B7A93; --color-border-input-hover: #8D9AB0;
  --color-text: #E6EBF2; --color-text-secondary: #B4BFCF; --color-text-tertiary: #8D9AB0; --color-text-disabled: #5D6A80;
  --color-text-inverse: #14233B; --color-tooltip-bg: #E6EBF2; --color-tooltip-text: #14233B;
  --color-skeleton: #1F2A3D; --color-skeleton-shine: #26324A;
  --color-success: #4CC38A; --color-success-bg: #10291E; --color-success-border: #2B6B4B; --color-success-fill: #4CC38A;
  --color-warning: #F0A54A; --color-warning-bg: #2E2210; --color-warning-border: #6B4A1A; --color-warning-fill: #F5A524;
  --color-danger: #F07171;  --color-danger-bg: #33181A;  --color-danger-border: #6E2A2D;  --color-danger-fill: #C22E2E;
  --color-info: #4FB5D6;    --color-info-bg: #0F2731;    --color-info-border: #1D5266;    --color-info-fill: #4FB5D6;
  --color-neutral: #B4BFCF; --color-neutral-bg: #101827; --color-neutral-border: #3A465C; --color-neutral-fill: #8D9AB0;
  --chart-1: #4C82EB; --chart-2: #00998A; --chart-3: #C07F22; --chart-4: #8A76E3;
  --chart-5: #D45F90; --chart-6: #5C9636; --chart-7: #3A98D8; --chart-8: #BE6E38;
  --chart-other: #8C9AB0; --chart-target: #E6EBF2; --chart-bench: #2A3447; --chart-bench-hatch: #3A465C;
  --chart-grid: #2A3447; --chart-axis: #8D9AB0;
  --elevation-1: 0 1px 2px rgba(0, 0, 0, 0.40);
  --elevation-2: 0 4px 12px rgba(0, 0, 0, 0.50);
  --elevation-3: 0 12px 32px rgba(0, 0, 0, 0.60);
}

@media (max-width: 767px) { :root { --page-gutter: 16px; } }
:root[data-embedded] { --page-gutter: 16px; }

@media (prefers-reduced-motion: reduce) {
  :root { --duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms; }
}

/* Release 3.0 only: inside Jira, map onto Atlassian tokens (fallbacks = our light values). Not active in 2.0. */
:root[data-embedded="atlassian"] {
  --color-text: var(--ds-text, #14233B);
  --color-text-secondary: var(--ds-text-subtle, #44546F);
  --color-text-tertiary: var(--ds-text-subtlest, #5E6C84);
  --color-text-disabled: var(--ds-text-disabled, #9AA6B8);
  --color-link: var(--ds-link, #1F5FCC);
  --color-primary: var(--ds-background-brand-bold, #1F5FCC);
  --color-primary-hover: var(--ds-background-brand-bold-hovered, #184EA8);
  --color-primary-pressed: var(--ds-background-brand-bold-pressed, #123F8A);
  --color-primary-subtle: var(--ds-background-selected, #EBF2FD);
  --color-focus: var(--ds-border-focused, #4C8DF6);
  --color-bg: var(--ds-surface, #F4F6F9);
  --color-surface: var(--ds-surface-raised, #FFFFFF);
  --color-surface-raised: var(--ds-surface-overlay, #FFFFFF);
  --color-surface-sunken: var(--ds-surface-sunken, #EEF1F6);
  --color-border: var(--ds-border, #DCE2EA);
  --color-border-input: var(--ds-border-input, #7D8AA0);
  --color-success: var(--ds-text-success, #17744A); --color-success-bg: var(--ds-background-success, #E6F4EC);
  --color-warning: var(--ds-text-warning, #A35200); --color-warning-bg: var(--ds-background-warning, #FFF3E0);
  --color-danger: var(--ds-text-danger, #C22E2E);   --color-danger-bg: var(--ds-background-danger, #FDECEC);
  --color-info: var(--ds-text-information, #0B6E8F); --color-info-bg: var(--ds-background-information, #E3F3F8);
  --elevation-1: var(--ds-shadow-raised, 0 1px 2px rgba(11, 31, 58, 0.08));
  --elevation-2: var(--ds-shadow-overlay, 0 4px 12px rgba(11, 31, 58, 0.12));
  --elevation-3: var(--ds-shadow-overlay, 0 12px 32px rgba(11, 31, 58, 0.18));
}
```

`styles/base.css` sets the body font and colours (§3), the global focus rule (§12.1), the skip link, `box-sizing: border-box`, `margin: 0` resets, `:where(h1,h2,h3)` sizes from the type tokens, `.pcp-tnum { font-variant-numeric: tabular-nums; }`, the visually-hidden utility `.pcp-sr-only`, and the scrollbar styling (thin, `--color-border-strong` thumb).
