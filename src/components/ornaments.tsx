/**
 * Solarpunk Medieval ornament & icon set (docs/design/design-system.md §5): one inline-SVG
 * family, `currentColor`, 1.5px stroke, round caps, no emoji, no raster. Every component is
 * `aria-hidden` (purely decorative) except where noted — callers own the accessible label.
 */

import type { CSSProperties } from "react";

interface OrnamentProps {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Woodcut sun with alternating straight/wavy rays. Masthead emblem and turning-point node. */
export function SunEmblem({ className, style }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v2.4M12 19.6V22M22 12h-2.4M4.4 12H2" />
      <path d="M18.4 5.6l-1.6 1.7M7.2 16.7l-1.6 1.7M18.4 18.4l-1.6-1.7M7.2 7.3L5.6 5.6" />
      <path d="M15.6 3.3c-.4 1-.6 1.8-.6 1.8M8.4 3.3c.4 1 .6 1.8.6 1.8M15.6 20.7c-.4-1-.6-1.8-.6-1.8M8.4 20.7c.4-1 .6-1.8.6-1.8" />
    </svg>
  );
}

/** A curling stem with 3–5 leaves. Placed top corners of the masthead and the change sheet. */
export function VineCorner({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2 2c8 0 10 6 10 12s4 14 16 14" />
      <path d="M8 6c2 2 2 4 0 6M14 12c2.4 1 3.4 3 2.6 5.6M20 20c2.6.6 4 2.4 3.6 5" />
    </svg>
  );
}

/** Hairline rule with a small central three-leaf sprig. Separates masthead / hero / timeline. */
export function SprigDivider({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width="20" height="14" className={className} aria-hidden="true">
      <path d="M10 13V4" />
      <path d="M10 8c-3-1-4-3-3.5-5.5C9 3 10 5 10 8Z" />
      <path d="M10 8c3-1 4-3 3.5-5.5C11 3 10 5 10 8Z" />
    </svg>
  );
}

/** Small branch icon at the start of an option card. */
export function LeafGlyph({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width="18" height="18" className={className} aria-hidden="true">
      <path d="M4 20c8-1 12-6 13-15" />
      <path d="M9 15c2-4 5-6 8-6" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width="18" height="18" className={className} aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CheckCircleIcon({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width="18" height="18" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.3l2.3 2.3 4.7-4.9" />
    </svg>
  );
}

export function MenuIcon({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width="20" height="20" className={className} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** Sprout — "Life" / home nav. */
export function SproutIcon({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width="20" height="20" className={className} aria-hidden="true">
      <path d="M12 21v-9" />
      <path d="M12 12c0-4 3-6 7-6 0 4-3 6-7 6Z" />
      <path d="M12 15c0-3.2-2.4-4.8-5.6-4.8 0 3.2 2.4 4.8 5.6 4.8Z" />
    </svg>
  );
}

/** Compass star — "Explore" nav. */
export function CompassStarIcon({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width="20" height="20" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-2 4.5L9 15l2-4.5L15 9Z" />
    </svg>
  );
}

/** Open book — "Library" nav. */
export function OpenBookIcon({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width="20" height="20" className={className} aria-hidden="true">
      <path d="M12 6c-2-1.4-4.6-2-8-2v13c3.4 0 6 .6 8 2 2-1.4 4.6-2 8-2V4c-3.4 0-6 .6-8 2Z" />
      <path d="M12 6v13" />
    </svg>
  );
}

/** Three dots — "More" nav. */
export function DotsIcon({ className }: OrnamentProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="20" height="20" className={className} aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}
