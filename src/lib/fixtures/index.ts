/**
 * The fixture backend for `src/lib/life-client.ts` (decision 040), selected by
 * `NEXT_PUBLIC_LIFE_FIXTURE=1`. Behaves like a small in-memory version of the real API:
 * `streamCreateLife` mints a new life and remembers it; `streamRewrite` mints a new branch and
 * remembers that too, so a later `fixtureChronicle`/`fixturePersonSheet` call for either can find
 * it. This lets the whole create → read → rewrite → re-read loop be exercised against fixtures
 * alone, including in the Playwright screenshot pass.
 */

import type { Chronicle, ChronicleEntry, CreateLifeRequest, LifeListItem, LifeStreamEvent, PersonSheet, RewriteRequest } from "@/contracts/life";
import { elinChronicles, personSheets, rosalindChronicle, livesList } from "./data";
import { delay, groupByYear, lowerFirst, renameProtagonistJson } from "./stream";

type StreamEmit = (event: LifeStreamEvent) => void;

// --- In-memory store: seeded from the static fixtures, extended by create/rewrite -----------

const branchStore = new Map<string, Chronicle>(); // `${lifeId}:${branchId}`
const latestBranch = new Map<string, string>(); // lifeId -> most recently written branchId
const extraBranchesByLife = new Map<string, Chronicle["branches"][number][]>(); // lifeId -> dynamically created branches
const baseLifeOf = new Map<string, string>(); // created lifeId -> the static fixture it was cloned from ("life-elin" | "life-rosalind")
const createdLifeSummaries: LifeListItem[] = [];

function key(lifeId: string, branchId: string): string {
  return `${lifeId}:${branchId}`;
}

function seedBranch(chronicle: Chronicle): void {
  branchStore.set(key(chronicle.lifeId, chronicle.branchId), chronicle);
  latestBranch.set(chronicle.lifeId, chronicle.branchId);
}

let staticSeeded = false;
function ensureStaticSeed(): void {
  if (staticSeeded) return;
  staticSeeded = true;
  for (const c of Object.values(elinChronicles)) branchStore.set(key(c.lifeId, c.branchId), c);
  latestBranch.set("life-elin", "branch-original");
  branchStore.set(key(rosalindChronicle.lifeId, rosalindChronicle.branchId), rosalindChronicle);
  latestBranch.set("life-rosalind", "branch-original");
}

function withMergedBranches(lifeId: string, chronicle: Chronicle): Chronicle {
  const extra = extraBranchesByLife.get(lifeId);
  if (!extra || extra.length === 0) return chronicle;
  const known = new Set(chronicle.branches.map((b) => b.branchId));
  const merged = [...chronicle.branches, ...extra.filter((b) => !known.has(b.branchId))];
  return { ...chronicle, branches: merged };
}

function addDynamicBranch(lifeId: string, branch: Chronicle["branches"][number]): void {
  const list = extraBranchesByLife.get(lifeId) ?? [];
  list.push(branch);
  extraBranchesByLife.set(lifeId, list);
}

// --- GET-style accessors ----------------------------------------------------------------------

export function fixtureChronicle(lifeId: string, branchId?: string): Chronicle {
  ensureStaticSeed();
  const resolvedBranchId = branchId ?? latestBranch.get(lifeId);
  const found = resolvedBranchId ? branchStore.get(key(lifeId, resolvedBranchId)) : undefined;
  if (!found) throw new Error(`No such life: ${lifeId}`);
  return withMergedBranches(lifeId, found);
}

export function fixturePersonSheet(lifeId: string, personId: string, branchId?: string): PersonSheet {
  ensureStaticSeed();
  const direct = personSheets[`${lifeId}:${personId}`];
  if (direct) return direct;
  const base = baseLifeOf.get(lifeId);
  const fromBase = base ? personSheets[`${base}:${personId}`] : undefined;
  if (fromBase) return fromBase;
  // A generic-rewrite branch can introduce no new named people (see computeGenericRewrite), so
  // this fallback only matters for a person referenced by id in a life this store doesn't know —
  // build a minimal, honest sheet from the chronicle's own cast list rather than 404 outright.
  const chronicle = fixtureChronicle(lifeId, branchId);
  const fromCast = chronicle.cast.find((c) => c.personId === personId);
  if (fromCast) {
    return { personId, name: fromCast.name, relation: fromCast.relation, birthYear: chronicle.protagonist.birthYear, deathYear: null, job: null, blurb: `${fromCast.name} appears in this chronicle.`, moments: [] };
  }
  throw new Error(`No such person: ${personId}`);
}

export function fixtureLives(): LifeListItem[] {
  ensureStaticSeed();
  return [...livesList, ...createdLifeSummaries];
}

// --- POST /api/lives/stream ---------------------------------------------------------------

function pickBaseChronicle(req: CreateLifeRequest): Chronicle {
  const wantsShort = req.seed === "short" || req.villageName?.trim().toLowerCase() === "ashcombe" || /rosalind/i.test(req.name);
  return wantsShort ? rosalindChronicle : elinChronicles["branch-original"];
}

export async function streamCreateLife(req: CreateLifeRequest, onEvent: StreamEmit, signal?: AbortSignal): Promise<void> {
  ensureStaticSeed();
  const base = pickBaseChronicle(req);
  const displayName = req.name.trim() || base.protagonist.name;
  const renamedJson = renameProtagonistJson(JSON.stringify(base), base.protagonist.name, displayName);
  const renamed = JSON.parse(renamedJson) as Chronicle;

  const lifeId = `life-${Math.random().toString(36).slice(2, 9)}`;
  const originalBranch = { branchId: "branch-original", label: "Original life", parentBranchId: null, forkYear: null } as const;
  const chronicle: Chronicle = { ...renamed, lifeId, branchId: originalBranch.branchId, villageName: req.villageName?.trim() || renamed.villageName, branches: [originalBranch] };
  baseLifeOf.set(lifeId, base.lifeId);

  onEvent({
    type: "start",
    lifeId,
    branchId: chronicle.branchId,
    villageName: chronicle.villageName,
    protagonist: { name: chronicle.protagonist.name, sex: chronicle.protagonist.sex, birthYear: chronicle.protagonist.birthYear },
  });

  for (const [year, entries] of groupByYear(chronicle.entries)) {
    if (signal?.aborted) return;
    await delay(160);
    onEvent({ type: "tick", year, entries });
  }
  if (signal?.aborted) return;

  seedBranch(chronicle);
  createdLifeSummaries.unshift({
    lifeId,
    name: chronicle.protagonist.name,
    birthYear: chronicle.protagonist.birthYear,
    deathYear: chronicle.protagonist.deathYear,
    ageAtDeath: chronicle.protagonist.ageAtDeath,
    causeOfDeath: chronicle.protagonist.causeOfDeath,
    branchCount: 1,
  });

  onEvent({
    type: "done",
    chronicle,
    stats: { jevCalls: chronicle.entries.length * 3, cacheHits: Math.round(chronicle.entries.length * 1.4), wallTimeMs: chronicle.entries.length * 160 },
  });
}

// --- POST /api/lives/:lifeId/rewrite/stream ------------------------------------------------

/** Curated rewrites, keyed by `lifeId|decisionId|optionId`, for the showcase divergence used in screenshots — full, hand-written alternate content rather than the generic fallback below. */
const CURATED: Readonly<Record<string, string>> = {
  "life-elin|dec-1516-marry|stay-unmarried": "branch-1516",
  "life-elin|dec-1516-marry|marry": "branch-original",
};

function buildGhosts(fromEntries: readonly ChronicleEntry[], toEntries: readonly ChronicleEntry[], afterYear: number): Record<string, string> {
  const ghosts: Record<string, string> = {};
  let count = 0;
  for (const e of toEntries) {
    if (e.year <= afterYear || count >= 2) continue;
    // Prefer an exact-year match over a same-year-±1 one, so the ghost reads as "what used to be
    // at this exact year" rather than accidentally pointing back at the divergence entry itself
    // (which also sits within ±1 of the next couple of post-divergence years).
    const was = fromEntries.find((x) => x.year === e.year && x.title !== e.title) ?? fromEntries.find((x) => Math.abs(x.year - e.year) <= 1 && x.title !== e.title && x.year !== afterYear);
    if (was) {
      ghosts[e.id] = `In the original life, ${lowerFirst(was.title)} (${was.year}).`;
      count++;
    }
  }
  return ghosts;
}

/**
 * The fallback for any turn without hand-written alternate content: a short but real-reading
 * alternate future that still ends with a proper death turn, so the chronicle always closes
 * cleanly. Disclosed limitation: it doesn't reflect *what* the new choice was beyond restating
 * it once, unlike the curated branch above.
 */
function computeGenericRewrite(from: Chronicle, divergenceEntry: ChronicleEntry, optionId: string, newLabel: string): { chronicle: Chronicle; ghosts: Record<string, string> } {
  const turn = divergenceEntry.turn!;
  const newBranchId = `branch-${divergenceEntry.year}-${Math.random().toString(36).slice(2, 6)}`;
  const updatedDivergence: ChronicleEntry = {
    ...divergenceEntry,
    turn: { ...turn, chosen: { optionId, label: newLabel }, alternatives: [turn.chosen, ...turn.alternatives].filter((o) => o.optionId !== optionId) },
  };
  const beforeEntries = from.entries.filter((e) => e.year < divergenceEntry.year);
  const p = from.protagonist;
  const firstName = p.name.split(" ")[0];
  const pronoun = p.sex === "f" ? "she" : "he";
  const Pronoun = p.sex === "f" ? "She" : "He";

  let afterEntries: ChronicleEntry[];
  if (divergenceEntry.kind === "death") {
    const lifeGoesOn: ChronicleEntry = {
      id: `${divergenceEntry.id}-cont`,
      year: divergenceEntry.year + 1,
      level: 2,
      kind: "reflection",
      title: `${firstName} lives on`,
      prose: `Against expectation, ${pronoun} lives past the year that once marked the end of this life.`,
      links: [],
    };
    afterEntries = [lifeGoesOn];
  } else {
    const span = Math.max(3, Math.round((p.deathYear - divergenceEntry.year) / 3));
    const newShape: ChronicleEntry = {
      id: `${divergenceEntry.id}-a1`,
      year: divergenceEntry.year + span,
      level: 1,
      kind: "reflection",
      title: "Life takes a different shape",
      prose: `In the years that follow, ${pronoun} settles into a life shaped by that one different choice.`,
      links: [],
    };
    const newDeath: ChronicleEntry = {
      id: `${divergenceEntry.id}-death`,
      year: p.deathYear,
      level: 3,
      kind: "death",
      title: `${p.name}'s life reaches its end`,
      prose: `In time, ${firstName}'s own body finally gives out — though the years between were lived differently this time.`,
      links: [],
      turn: {
        decisionId: `dec-${p.deathYear}-death-${newBranchId}`,
        decidedBy: "Chance",
        deciderId: "chance",
        chosen: { optionId: "dies", label: `${Pronoun} dies of old age` },
        alternatives: [{ optionId: "survives", label: `${Pronoun} survives this year` }],
        whyPhrase: "This was a fairly likely outcome.",
        probabilities: { dies: 0.7, survives: 0.3 },
      },
    };
    afterEntries = [newShape, newDeath].filter((e) => e.year > divergenceEntry.year);
  }

  const entries = [...beforeEntries, updatedDivergence, ...afterEntries];
  const lastYear = entries[entries.length - 1]?.year ?? p.deathYear;
  const newBranchInfo = { branchId: newBranchId, label: `Changed in ${divergenceEntry.year}`, parentBranchId: from.branchId, forkYear: divergenceEntry.year } as const;
  const chronicle: Chronicle = {
    ...from,
    branchId: newBranchId,
    entries,
    protagonist: { ...p, deathYear: lastYear, ageAtDeath: lastYear - p.birthYear },
    branches: [...from.branches, newBranchInfo],
  };
  const ghosts = buildGhosts(from.entries, entries, divergenceEntry.year);
  return { chronicle, ghosts };
}

export async function streamRewrite(lifeId: string, req: RewriteRequest, onEvent: StreamEmit, signal?: AbortSignal): Promise<void> {
  ensureStaticSeed();
  let from: Chronicle;
  try {
    from = fixtureChronicle(lifeId, req.branchId);
  } catch {
    onEvent({ type: "error", message: "That life could not be found." });
    return;
  }

  const divergenceEntry = from.entries.find((e) => e.turn?.decisionId === req.decisionId);
  if (!divergenceEntry || !divergenceEntry.turn) {
    onEvent({ type: "error", message: "That moment can no longer be changed." });
    return;
  }
  const turn = divergenceEntry.turn;
  const option = [turn.chosen, ...turn.alternatives].find((o) => o.optionId === req.optionId);
  if (!option) {
    onEvent({ type: "error", message: "That option is no longer available." });
    return;
  }
  const originalLabel = turn.chosen.label;
  const newLabel = option.label;

  onEvent({ type: "start", lifeId, branchId: from.branchId, villageName: from.villageName, protagonist: { name: from.protagonist.name, sex: from.protagonist.sex, birthYear: from.protagonist.birthYear } });
  if (signal?.aborted) return;
  onEvent({ type: "divergence", entryId: divergenceEntry.id, year: divergenceEntry.year, originalLabel, newLabel });

  const curatedTarget = CURATED[`${lifeId}|${req.decisionId}|${req.optionId}`];
  const { chronicle: target, ghosts } = curatedTarget
    ? { chronicle: fixtureChronicle(lifeId, curatedTarget), ghosts: buildGhosts(from.entries, fixtureChronicle(lifeId, curatedTarget).entries, divergenceEntry.year) }
    : computeGenericRewrite(from, divergenceEntry, req.optionId, newLabel);

  const newEntries = target.entries.filter((e) => e.year >= divergenceEntry.year && !from.entries.some((f) => f.id === e.id && f.year === e.year && f.title === e.title));

  for (const [year, entries] of groupByYear(newEntries)) {
    if (signal?.aborted) return;
    await delay(220);
    onEvent({ type: "tick", year, entries });
  }
  if (signal?.aborted) return;

  if (!curatedTarget) {
    seedBranch(target);
    addDynamicBranch(lifeId, target.branches[target.branches.length - 1]);
  }

  onEvent({
    type: "done",
    chronicle: withMergedBranches(lifeId, target),
    ghosts,
    stats: { jevCalls: newEntries.length * 4 + 20, cacheHits: newEntries.length * 2, wallTimeMs: newEntries.length * 220 + 300 },
  });
}
