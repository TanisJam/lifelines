/**
 * Name placement on the sky. Every star draws its name under itself, but the layout packs families into
 * sectors, so neighbours can land a few units apart and their names would print on top of each other.
 * A name is kept only when its box clears every name kept before it: the protagonist first, then the
 * story circle, then the village beyond it (scene order inside a rank), so a dense cluster loses the
 * names that matter least instead of turning into unreadable ink.
 */

export interface LabelCandidate {
  readonly id: string;
  /** Resting place of the star the name hangs under, in the 800-unit sky space. */
  readonly x: number;
  readonly y: number;
  readonly name: string;
  /** 0 = protagonist, 1 = story circle, 2 = beyond it. Lower ranks win a contested patch of sky. */
  readonly rank: number;
}

interface Box {
  readonly id: string;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** Match `.sky-nm` font sizes and baseline offsets (including the mobile translation) in sky units. */
const FONT = [18, 14.5];
const MOBILE_FONT = [32, 28];
const BASELINE = [30, 19];
/** Mean advance of the serif at that size, and the halo its painted stroke adds on each side. */
const ADVANCE = 0.46;
const PAD = 3;

function box(c: LabelCandidate, mobile: boolean): Box {
  const tier = c.rank === 0 ? 0 : 1;
  const font = (mobile ? MOBILE_FONT : FONT)[tier]!;
  const half = (c.name.length * font * ADVANCE) / 2 + PAD;
  const baseline = c.y + BASELINE[tier]! + (mobile ? 7 : 0);
  return { id: c.id, x0: c.x - half, x1: c.x + half, y0: baseline - font * 0.78 - PAD, y1: baseline + font * 0.22 + PAD };
}

const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The ids whose names fit on the sky, decided greedily in rank order (a stable sort keeps scene order inside a rank). */
export function keptLabels(candidates: readonly LabelCandidate[], mobile = false): ReadonlySet<string> {
  const placed: Box[] = [];
  const kept = new Set<string>();
  for (const candidate of [...candidates].sort((a, b) => a.rank - b.rank)) {
    const next = box(candidate, mobile);
    if (placed.some((p) => overlaps(next, p))) continue;
    placed.push(next);
    kept.add(next.id);
  }
  return kept;
}
