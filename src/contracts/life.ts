/**
 * Shared contract between the single-life engine (src/domain, src/server, src/app/api) and the
 * Living Chronicle UI (src/app, src/components). Types only — no runtime code.
 * See docs/design/single-life-contract.md and decision 034.
 */

export type LifeSex = "f" | "m";

/** POST /api/lives/stream request body. */
export interface CreateLifeRequest {
  readonly name: string;
  readonly sex: LifeSex | "random";
  /** Optional; a random seed is used when omitted. */
  readonly seed?: string;
  /** Optional; a generated village name is used when omitted. */
  readonly villageName?: string;
  /** Decision 059: the reader's locale, for the chronicle this request's `done` event carries — defaults to `"en"` when omitted. Never affects simulation or the Jev-facing decision text, only the narrated prose/title/summary built afterward. */
  readonly lang?: string;
  /** Abuse protection: the Cloudflare Turnstile token from the create-life form's widget. Ignored when Turnstile isn't configured server-side (see `src/server/turnstile.ts`). */
  readonly turnstileToken?: string;
}

/** POST /api/lives/:lifeId/rewrite/stream request body. */
export interface RewriteRequest {
  readonly branchId: string;
  readonly decisionId: string;
  readonly optionId: string;
  /** Decision 059: same meaning as `CreateLifeRequest.lang`. */
  readonly lang?: string;
  /** Abuse protection: same meaning as `CreateLifeRequest.turnstileToken`. */
  readonly turnstileToken?: string;
}

/** A person linked from prose. Prose marks links as `{{personId}}`; `links` resolves them. */
export interface PersonLink {
  readonly personId: string;
  readonly name: string;
}

/** 1 = ordinary, 2 = significant, 3 = turn (editable). ui-ux-handoff.md §7. */
export type EntryLevel = 1 | 2 | 3;

export interface TurnOption {
  readonly optionId: string;
  /** Narrative, past tense, from the protagonist's chronicle perspective: "She stayed in Ravenford". */
  readonly label: string;
}

/** Present only on level-3 entries. */
export interface Turn {
  readonly decisionId: string;
  /** Whose choice it was, for the modal: "Her choice", "Tomas Vell's choice", "Chance". */
  readonly decidedBy: string;
  /** "self" when the protagonist decided, "chance" for biology/world rolls, else the NPC's personId. */
  readonly deciderId: "self" | "chance" | string;
  readonly chosen: TurnOption;
  readonly alternatives: readonly TurnOption[];
  /** Emotional reading for "Why did she choose this?": "She almost chose otherwise.", etc. */
  readonly whyPhrase: string;
  /** Optional numbers shown under whyPhrase. Keys are optionIds. */
  readonly probabilities?: Readonly<Record<string, number>>;
  /** How likely this was to be what happened this year, among the alternatives (round 12, decision 045's joint event-selection Choice's normalized share for the selected candidate) — independent of `probabilities`, which is about which option won GIVEN it happened. Absent when the deciding call didn't report one (a forced decision, or the legacy per-candidate path). */
  readonly occurrenceProbability?: number;
}

/** Night-sky scene graph (spec: life-scene). Times are fractional years (1350.5 = mid-1350). */
export type SceneGroup = "self" | "parents" | "siblings" | "spouses" | "children" | "others" | "outer";
export type RelCode = "self" | "parent" | "sibling" | "spouse" | "child" | "lover" | "rival" | "friend" | "childSpouse" | "grandchild";
export type EdgeKind = "parent" | "spouse" | "lover" | "rival" | "friend";

export interface ScenePerson {
  readonly id: string;
  readonly name: string;
  readonly sex: LifeSex;
  readonly relCode: RelCode;
  readonly group: SceneGroup;
  readonly born: number;
  readonly appearsAt: number;
  readonly diedAt?: number;
  /** Outer ring only: the child this person hangs from. */
  readonly anchor?: string;
}

export interface SceneEdge {
  readonly a: string;
  readonly b: string;
  readonly kind: EdgeKind;
  /** `null` = the bond predates the life. */
  readonly fromAt: number | null;
  readonly untilAt?: number;
}

/** A background villager. `k` is the person id: a stable placement key, never an array index. */
export interface VillageSoul {
  readonly k: string;
  /** Born or arrival year. */
  readonly b: number;
  /** Death or departure year; absent while present. */
  readonly d?: number;
}

export interface SceneBand {
  readonly kind: "black-death" | "second-pestilence";
  readonly from: number;
  readonly to: number;
}

export interface LifeScene {
  readonly people: readonly ScenePerson[];
  readonly edges: readonly SceneEdge[];
  readonly village: readonly VillageSoul[];
  readonly bands: readonly SceneBand[];
  readonly span: { readonly start: number; readonly end: number | null };
}

export interface ChronicleEntry {
  readonly id: string;
  readonly year: number;
  /** Set for period summaries ("1528–1532 — …"). */
  readonly endYear?: number;
  readonly level: EntryLevel;
  readonly kind: "birth" | "death" | "period" | string;
  readonly title: string;
  /** May contain `{{personId}}` markers resolved through `links`. */
  readonly prose: string;
  readonly links: readonly PersonLink[];
  /** At most one: "Follows her courtship with Greta Ravensworth (1506)". */
  readonly cause?: { readonly entryId?: string; readonly phrase: string; readonly year: number };
  readonly turn?: Turn;
  /** Fractional year (1350.5 = mid-1350) the event happened; `year <= at < year + 1`. */
  readonly at: number;
  /** Scene person ids the entry involves; every id resolves in the accompanying `LifeScene`. */
  readonly who: readonly string[];
}

export interface BranchInfo {
  readonly branchId: string;
  /** "Original life" | "Changed in 1514". Never git terms. */
  readonly label: string;
  readonly parentBranchId: string | null;
  readonly forkYear: number | null;
}

export interface ProtagonistInfo {
  readonly name: string;
  readonly sex: LifeSex;
  readonly birthYear: number;
  readonly deathYear: number;
  readonly ageAtDeath: number;
  /** Short cause: "a winter fever", "childbirth", "old age". */
  readonly causeOfDeath: string;
}

export interface Chronicle {
  readonly lifeId: string;
  readonly branchId: string;
  readonly villageName: string;
  readonly protagonist: ProtagonistInfo;
  /** Epitaph-like ending paragraph (lifeSummary). May contain `{{personId}}` markers. */
  readonly summary: string;
  readonly summaryLinks: readonly PersonLink[];
  /** Optional "After their death" lines. */
  readonly epilogue: readonly string[];
  readonly entries: readonly ChronicleEntry[];
  readonly branches: readonly BranchInfo[];
  /** Left rail: people in this life with their relation to the protagonist. */
  readonly cast: readonly { readonly personId: string; readonly name: string; readonly relation: string }[];
  /** The night-sky scene graph for the whole life. */
  readonly scene: LifeScene;
}

/** GET /api/lives/:lifeId/people/:personId?branchId= — read-only side sheet. */
export interface PersonSheet {
  readonly personId: string;
  readonly name: string;
  readonly relation: string;
  readonly birthYear: number;
  readonly deathYear: number | null;
  readonly job: string | null;
  /** One or two sentences, from the protagonist's point of view. */
  readonly blurb: string;
  readonly moments: readonly { readonly year: number; readonly title: string }[];
}

/** GET /api/lives — "Your lives". */
export interface LifeListItem {
  readonly lifeId: string;
  readonly name: string;
  readonly birthYear: number;
  readonly deathYear: number;
  readonly ageAtDeath: number;
  readonly causeOfDeath: string;
  readonly branchCount: number;
}

/**
 * SSE events for both /api/lives/stream and /api/lives/:lifeId/rewrite/stream.
 * `event:` name = the `type` field; `data:` = JSON of the object.
 */
export type LifeStreamEvent =
  | { readonly type: "start"; readonly lifeId: string; readonly branchId: string; readonly villageName: string; readonly protagonist: { readonly name: string; readonly sex: LifeSex; readonly birthYear: number } }
  /** Rewrite only, sent first: the divergence entry with its old and new outcome labels. */
  | { readonly type: "divergence"; readonly entryId: string; readonly year: number; readonly originalLabel: string; readonly newLabel: string }
  /** One per simulated year, quiet years included (`entries` empty). `entries` are the protagonist's NEW chronicle entries for that year; `scene` is the full scene so far. */
  | { readonly type: "tick"; readonly year: number; readonly entries: readonly ChronicleEntry[]; readonly scene: LifeScene }
  | {
      readonly type: "done";
      readonly chronicle: Chronicle;
      /** Rewrite only: sparse ghost annotations keyed by new entry id ("In the original life, …"). */
      readonly ghosts?: Readonly<Record<string, string>>;
      readonly stats: {
        readonly jevCalls: number;
        readonly cacheHits: number;
        readonly wallTimeMs: number;
        /** Round 12 (decision 045): real (non-cached) DecisionMaker requests made for THIS life alone — a before/after delta around the simulation, never the adapter's process-cumulative counter (the adapter instance is shared across every life in the process, see `server/decision-engine.ts`). */
        readonly jevRequests?: number;
        /** Individual Noul/Choice/Score questions asked across this life's `jevRequests` (a batched `decideYear` request carries several) — same per-life delta discipline as `jevRequests`. */
        readonly jevQuestions?: number;
        /** Input tokens consumed by this life's own requests only (delta, not cumulative). */
        readonly inputTokens?: number;
        /** `inputTokens * 0.042 / 1_000_000` — this life's own estimated cost in USD from input tokens alone. */
        readonly estimatedUsd?: number;
      };
    }
  | { readonly type: "error"; readonly message: string };
