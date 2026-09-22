# Lifelines Design System — "Solarpunk Medieval"

Source of truth for how Lifelines looks and feels. Supersedes the "Living Chronicle" editorial
theme (decisions 029/031) for surfaces, color, type and ornament; interaction contracts from
`ui-ux-handoff.md` (change flow, streaming, rewrite animation) still apply.

## 1. Concept

An illuminated manuscript with a garden growing through it. Medieval in its materials
(parchment, ink, gilt, woodcut suns, botanical marginalia); solarpunk in its mood (daylight,
living greenery, hope, repair). History is kind here: changing a moment is gentle, never
destructive — "Same people. Brighter tomorrows."

Principles:

1. **Paper, not glass.** Every surface is a sheet of warm parchment. No blur-glass, no neon, no
   hard black chrome.
2. **Life is green, time is gold.** Sage/forest green marks life, choice and action. Sun gold
   marks time, turning points and change.
3. **Ornament frames, never competes.** Vines, sprigs and suns live in corners and dividers.
   Content columns stay clean and readable.
4. **Calm hierarchy.** Centered masthead and hero, a single quiet timeline, one primary action
   per screen.
5. **Change is visible, not violent.** Replaced history is struck through and faded, not
   deleted; new history inks in.

## 2. Color tokens

Semantic tokens (CSS custom properties). Components never use raw hex.

| Token | Light | Dark ("night garden") | Use |
|---|---|---|---|
| `--ll-parchment` | `#f4ecdb` | `#1b1f18` | Page background |
| `--ll-paper` | `#f8f2e4` | `#22271e` | Sheets, cards, the chronicle page |
| `--ll-paper-deep` | `#ece1c9` | `#171a14` | Recessed areas, bottom bars |
| `--ll-ink` | `#2c2a22` | `#ece4cf` | Primary text (AA+ on paper) |
| `--ll-ink-soft` | `#5c5746` | `#bfb59c` | Secondary text, years, captions |
| `--ll-ink-faint` | `#9c9480` | `#7a7362` | Replaced history, disabled, placeholders |
| `--ll-rule` | `#d6c7a3` | `#3d4233` | Hairlines, card borders, timeline spine |
| `--ll-leaf` | `#6f8a4c` | `#9cb97e` | Botanical ornament, timeline nodes |
| `--ll-forest` | `#3e5a3a` | `#a9c690` | Primary action, active nav, links |
| `--ll-forest-ink` | `#f6efdc` | `#16200f` | Text on `--ll-forest` |
| `--ll-sage-tint` | `#e2e5cf` | `#2b3424` | Selected/current option background |
| `--ll-sun` | `#c8962f` | `#e0b457` | Sun emblem, turning-point node, gilt rims (decorative only) |
| `--ll-sun-ink` | `#86611a` | `#e6c27a` | Gold text (AA on paper) |
| `--ll-sun-tint` | `#f1e2bd` | `#3a3220` | Highlighted turning-point card, branch ribbon fill |
| `--ll-sun-edge` | `#dcc186` | `#6b5a33` | Border of highlighted card/ribbon |
| `--ll-danger` | `#8e413d` | `#d69086` | Errors only |

Contrast rules: body text uses `--ll-ink` or `--ll-ink-soft` only. `--ll-sun` is never used for
text; use `--ll-sun-ink`. `--ll-ink-faint` is reserved for content that is intentionally
de-emphasized (replaced history), and is always paired with a second signal (strike-through).

Dark mode is a moonlit garden, not an inversion: deep green-black paper, warm ivory ink, brighter
leaf and gold.

## 3. Typography

All serif — the manuscript voice extends to UI chrome. No sans-serif in the reading experience.

| Role | Font | Size / line-height | Notes |
|---|---|---|---|
| Wordmark | Cormorant Garamond 500 | 30px / 1 | "Lifelines" |
| Tagline / eyebrow | Cinzel 500 | 9–11px, tracking `0.14em`, uppercase | "SAME PEOPLE. BRIGHTER TOMORROWS." |
| Display (person name) | Cormorant Garamond 500 | `clamp(32px, 6vw, 48px)` / 1.05 | Centered |
| Title (sheet heading, event title) | Cormorant Garamond 500 | 22–26px / 1.25 | |
| Body | Crimson Pro 400 | 17px / 1.6 (min 16px) | Summaries, event text |
| Year | Crimson Pro 400, tabular nums | 16px | Timeline year column |
| UI label (buttons, nav, options) | Crimson Pro 500 | 15–17px | Nav labels 12–13px |
| Quote / note | Crimson Pro italic | 14–15px | Footer quote, "History changed here" |

Loaded via `next/font/google` (already present: Cormorant Garamond, Crimson Pro, Cinzel). Inter
is retired from the reading UI.

## 4. Spacing, shape, elevation

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48. Page gutter 20px mobile, 32px desktop.
- Reading column: max 640px for the chronicle; body text measure ≤ 60ch.
- Radii: `--ll-radius-sm: 6px` (chips), `--ll-radius: 12px` (cards, options),
  `--ll-radius-lg: 20px` (sheets), `999px` (primary button, ribbon, nav indicator).
- Elevation is soft, warm and low:
  - `--ll-shadow-card: 0 1px 2px rgb(60 45 20 / 0.06), 0 4px 12px rgb(60 45 20 / 0.06)`
  - `--ll-shadow-sheet: 0 -12px 40px rgb(40 30 10 / 0.18)`
- Scrim for sheets/modals: `rgb(30 26 18 / 0.5)` — dims the page to sepia, no blur needed.
- Paper grain: a very subtle multiply noise layer over `--ll-parchment` (existing grain
  technique, retinted warm).

## 5. Ornament & iconography

All inline SVG, `currentColor`, stroke 1.5px, round caps — one family, no emoji, no raster.

- **Sun emblem** (`--ll-sun`): woodcut sun with a face-free round disc and 12–16 alternating
  straight/wavy rays. Used in the masthead and as the turning-point timeline node (small).
- **Vine corners** (`--ll-leaf`): a curling stem with 3–5 leaves, placed top-left/top-right of the
  masthead and the change sheet. Mirrored, `aria-hidden`, never overlapping text.
- **Sprig divider**: hairline rule (`--ll-rule`) with a small central three-leaf sprig. Separates
  masthead / hero / summary / timeline.
- **Leaf glyph**: small branch icon at the start of each option card.
- **UI icons**: chevron-right, check-in-circle, menu (3 lines), and nav icons (sprout = Life,
  compass-star = Explore, open book = Library, three dots = More). Same stroke style.

## 6. Components

### Masthead
Centered: sun emblem + "Lifelines" wordmark, tagline beneath in Cinzel eyebrow style. Vine
corners on both sides. Menu button (≥44px target) at the right. Sits on parchment — no dark bar.

### Hero (life header)
Person name (display), `birth — death` years in `--ll-ink-soft` with tabular numerals, sprig
divider, then the life summary as centered body text (max 36ch on mobile). Optional branch
ribbon between years and summary.

### Branch ribbon
Pill with pointed/diamond ends, `--ll-sun-tint` fill, 1px `--ll-sun-edge` border, `--ll-sun-ink`
text: "Branch from 1514". Marks that the reader is viewing an alternate history.

### Timeline
- Three columns: year (right-aligned, tabular, `--ll-ink-soft`) · spine · event text.
- Spine: 1px `--ll-rule` vertical line. Nodes: 7px hollow circles, 1.5px `--ll-leaf` stroke on
  paper fill.
- Turning point (a moment the user can change / did change): node becomes the small sun glyph;
  the row is wrapped in a highlight card (`--ll-sun-tint`, `--ll-sun-edge` border,
  `--ll-radius`). Inside: the event title in medium weight, the outcome ("She stayed in
  Ravenford."), and a text link "Change what happened →" in `--ll-forest`, underlined.
- After a change: the divergence card reads "History changed here" (italic, `--ll-ink-soft`).
  Replaced events stay in place: `--ll-ink-faint` + `line-through`, hollow faint node. New
  events ink in with the existing `ink-in` animation.
- Marginal quote (optional, desktop/wide): italic `--ll-ink-soft`, e.g. "New places grow new
  people."

### Change sheet (bottom sheet on mobile, centered card ≥640px)
Paper surface, `--ll-radius-lg` top corners, grabber handle, vine corners. Content, centered:
year (title size), the moment as a title, the consequence line ("Everything after this moment
will be rewritten.") in `--ll-ink-soft`, sprig divider, prompt "How does this moment unfold?",
then option cards, then the primary action, then an italic footer quote.

### Option card
Full-width, min-height 56px, `--ll-paper` fill, 1px `--ll-rule`, `--ll-radius`,
`--ll-shadow-card`. Leaf glyph · label · chevron. Current history: `--ll-sage-tint` fill,
`--ll-leaf` border, check-in-circle (filled `--ll-forest`) instead of chevron, secondary line
"(Current history)". Selected (pending): `--ll-forest` 1.5px border + check. Hover: border
`--ll-leaf`. Press: `scale(0.98)`.

### Primary button
Full-width pill, `--ll-forest` fill, `--ll-forest-ink` label (Crimson Pro 500, 17px), with a
gilt inner rim: `box-shadow: inset 0 0 0 2px var(--ll-forest), inset 0 0 0 3px var(--ll-sun)`.
Min height 48px. Disabled: 45% opacity, no rim. Loading: label swaps to progress text; button
disabled.

### Text link
`--ll-forest`, underline with 2px offset, trailing arrow where it navigates or opens a sheet.

### Bottom tab bar (mobile)
Parchment bar with a top hairline, ≤5 items, icon + serif label. Active item: `--ll-forest`
icon/label and a short 2px underline beneath the label. Respects the safe area. Desktop keeps a
top masthead navigation instead.

### Person sheet, drawers, toasts
Same paper language as the change sheet (no dark chrome). The "regenerating" pill becomes a
paper pill with a pulsing `--ll-sun` dot.

## 7. Motion

- Durations: 150ms (press/hover), 250ms (sheet in), 180ms (sheet out), 400–750ms (rewrite and
  ink-in, staggered 30–50ms per entry).
- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)` for entering, `ease-in` for exiting.
- Meaning: sheets rise from the bottom (a moment being opened); replaced history fades and
  strikes through; new history inks in top-to-bottom.
- `prefers-reduced-motion`: no blur, no stagger, no translate; instant state changes with a
  short opacity fade only.

## 8. Accessibility

- Text contrast ≥ 4.5:1 in both themes (tokens above are chosen for this).
- Replaced history uses strike-through + faint color + screen-reader text ("replaced").
- Touch targets ≥ 44px; visible focus ring `2px solid var(--ll-forest)` offset 2px.
- Ornament SVGs are `aria-hidden`; the sun turning-point node has an accessible label
  ("turning point").
- Sheets trap focus, close on Escape and scrim tap, and return focus to the trigger.

## 9. Anti-patterns

- Dark topbars or black chrome (the old `--cw-dark` surfaces).
- Sans-serif in reading UI; emoji as icons; raster icons.
- Gold text on parchment (fails contrast) — use `--ll-sun-ink`.
- Ornament inside the reading column or behind text.
- More than one primary (forest) button per screen.
- Deleting replaced history from view instead of striking it through.
