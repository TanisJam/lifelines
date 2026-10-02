/**
 * Hand-written fixture data for the Living Chronicle (decision 040). Two lives:
 *
 * - `life-elin` — a full life, Elin Marrow of Hallowmere (1490–1554), ~35 entries spanning all
 *   three levels, a period summary, turns decided by herself, by an NPC ("Tomas Vell's choice")
 *   and by chance, and a death turn.
 * - `life-rosalind` — a short early-death life, Rosalind Thorn of Ashcombe (1602–1608, dies of a
 *   fever at six).
 *
 * Both are real, readable prose — not placeholder text — so screenshots taken against them are
 * honest previews of the real product.
 */

import type { BranchInfo, Chronicle, ChronicleEntry, LifeListItem, LifeScene, PersonSheet, SceneEdge, ScenePerson } from "@/contracts/life";

/** Hand-written entries carry only prose-level data; `at` and `who` are derived from them below. */
type AuthoredEntry = Omit<ChronicleEntry, "at" | "who">;

/** Spreads each year's entries across the year in order and ties them to the scene people their links name. */
function withTiming(entries: readonly AuthoredEntry[], scene: LifeScene): ChronicleEntry[] {
  const ids = new Set(scene.people.map((p) => p.id));
  const perYear = new Map<number, number>();
  for (const e of entries) perYear.set(e.year, (perYear.get(e.year) ?? 0) + 1);
  const seen = new Map<number, number>();
  return entries.map((e) => {
    const k = seen.get(e.year) ?? 0;
    seen.set(e.year, k + 1);
    return { ...e, at: e.year + 0.1 + (0.8 * (k + 0.5)) / perYear.get(e.year)!, who: e.links.map((l) => l.personId).filter((id) => ids.has(id)) };
  });
}

const person = (id: string, name: string, sex: ScenePerson["sex"], relCode: ScenePerson["relCode"], group: ScenePerson["group"], born: number, appearsAt: number, diedAt?: number): ScenePerson => ({ id, name, sex, relCode, group, born, appearsAt, ...(diedAt !== undefined ? { diedAt } : {}) });
const edge = (a: string, b: string, kind: SceneEdge["kind"], fromAt: number | null, untilAt?: number): SceneEdge => ({ a, b, kind, fromAt, ...(untilAt !== undefined ? { untilAt } : {}) });

const ORIGINAL: BranchInfo = { branchId: "branch-original", label: "Original life", parentBranchId: null, forkYear: null };
const CHANGED_1516: BranchInfo = { branchId: "branch-1516", label: "Changed in 1516", parentBranchId: "branch-original", forkYear: 1516 };

// --- Elin Marrow — the original branch ------------------------------------------------------

const elinEntriesOriginal: AuthoredEntry[] = [
  {
    id: "e01",
    year: 1490,
    level: 2,
    kind: "birth",
    title: "Elin Marrow is born",
    prose: "Elin Marrow is born in Hallowmere, the first daughter of {{petra}} and {{joren}}.",
    links: [
      { personId: "petra", name: "Petra Marrow" },
      { personId: "joren", name: "Joren Marrow" },
    ],
  },
  {
    id: "e02",
    year: 1494,
    level: 1,
    kind: "childhood",
    title: "Takes her first steps by the mill",
    prose: "She takes her first steps on the path by the mill, chasing the geese into the millpond.",
    links: [],
  },
  {
    id: "e03",
    year: 1498,
    level: 1,
    kind: "childhood",
    title: "Learns her letters",
    prose: "The miller's wife teaches her to read from a single water-stained psalter, passed hand to hand around the village.",
    links: [],
  },
  {
    id: "e04",
    year: 1500,
    level: 2,
    kind: "childhood",
    title: "Begins helping at the healer's house",
    prose: "She begins fetching water and herbs for {{margit}}, the village healer, who notices the girl doesn't flinch at blood.",
    links: [{ personId: "margit", name: "Margit Holt" }],
  },
  {
    id: "e05",
    year: 1502,
    level: 1,
    kind: "childhood",
    title: "Befriends Mireille Cade",
    prose: "She and {{mireille}}, the tanner's daughter, become inseparable, trading secrets at the well.",
    links: [{ personId: "mireille", name: "Mireille Cade" }],
  },
  {
    id: "e06",
    year: 1504,
    level: 3,
    kind: "illness",
    title: "Falls ill with a winter fever",
    prose: "A winter fever sweeps through Hallowmere, and Elin is among the worst struck. For three days her mother doesn't leave her side.",
    links: [],
    turn: {
      decisionId: "dec-1504-fever",
      decidedBy: "Chance",
      deciderId: "chance",
      chosen: { optionId: "recovers", label: "She recovers, weak but breathing" },
      alternatives: [{ optionId: "dies", label: "The fever takes her" }],
      whyPhrase: "She almost didn't make it.",
      probabilities: { recovers: 0.62, dies: 0.38 },
    },
  },
  {
    id: "e07",
    year: 1506,
    level: 1,
    kind: "apprenticeship",
    title: "Formally apprenticed to Margit Holt",
    prose: "At sixteen she is formally apprenticed to {{margit}}, who teaches her which roots ease a fever and which ones stop a heart.",
    links: [{ personId: "margit", name: "Margit Holt" }],
  },
  {
    id: "e08",
    year: 1508,
    level: 2,
    kind: "friendship",
    title: "Meets Tomas Vell",
    prose: "She meets {{tomas}}, a carter's son newly arrived from Ashford, when he brings his father to Margit's door with a broken wrist.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
  },
  {
    id: "e09",
    year: 1510,
    level: 1,
    kind: "village",
    title: "Treats her first patient alone",
    prose: "Margit lets her set a bone alone for the first time — a farmhand's arm, mended straight and true.",
    links: [],
  },
  {
    id: "e10",
    year: 1512,
    level: 3,
    kind: "courtship",
    title: "Tomas Vell chooses who to court",
    prose: "{{tomas}} has been walking two girls home after market — Elin, and Mireille's cousin from Ashford. He makes up his mind.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
    turn: {
      decisionId: "dec-1512-court",
      decidedBy: "Tomas Vell's choice",
      deciderId: "tomas",
      chosen: { optionId: "court-elin", label: "He begins courting Elin" },
      alternatives: [{ optionId: "court-other", label: "He begins courting the Ashford girl" }],
      whyPhrase: "It was closer than it looked.",
      probabilities: { "court-elin": 0.55, "court-other": 0.45 },
    },
  },
  {
    id: "e11",
    year: 1514,
    level: 2,
    kind: "courtship",
    title: "Courtship with Tomas Vell deepens",
    prose: "Two years of courtship pass. {{tomas}} takes over his father's cart route; Elin is trusted with Margit's whole store of remedies.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
    cause: { entryId: "e10", phrase: "Tomas Vell's choice to court her", year: 1512 },
  },
  {
    id: "e12",
    year: 1516,
    level: 3,
    kind: "marriage",
    title: "Decides whether to marry Tomas Vell",
    prose: "{{tomas}} asks her to marry him. Margit is aging, and the healer's house will need someone to run it outright, married or not.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
    turn: {
      decisionId: "dec-1516-marry",
      decidedBy: "Her choice",
      deciderId: "self",
      chosen: { optionId: "marry", label: "She marries Tomas Vell" },
      alternatives: [{ optionId: "stay-unmarried", label: "She stays unmarried, devoted to the healer's trade" }],
      whyPhrase: "She almost chose otherwise.",
      probabilities: { marry: 0.71, "stay-unmarried": 0.29 },
    },
  },
  {
    id: "e13",
    year: 1517,
    level: 1,
    kind: "marriage",
    title: "Marries in the chapel at midsummer",
    prose: "She and {{tomas}} marry in the chapel at midsummer; Margit gives away the bride, having no daughter of her own.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
  },
  {
    id: "e14",
    year: 1519,
    level: 1,
    kind: "pregnancy",
    title: "Expecting her first child",
    prose: "She is expecting her first child, and treats her own morning sickness with the same brisk patience she gives her patients.",
    links: [],
  },
  {
    id: "e15",
    year: 1520,
    level: 2,
    kind: "birth",
    title: "Daughter Wren Vell is born",
    prose: "Her daughter {{wren}} is born in the healer's house, delivered by Margit's own hands.",
    links: [{ personId: "wren", name: "Wren Vell" }],
  },
  {
    id: "e16",
    year: 1522,
    level: 1,
    kind: "family",
    title: "Margit Holt retires",
    prose: "{{margit}} finally retires, leaving the healer's house — and its whole trade — to Elin outright.",
    links: [{ personId: "margit", name: "Margit Holt" }],
  },
  {
    id: "e17",
    year: 1524,
    level: 3,
    kind: "childbirth",
    title: "A difficult second birth",
    prose: "Her second labor turns difficult in the night. She has delivered a dozen breech births for other women; her own is worse.",
    links: [],
    turn: {
      decisionId: "dec-1524-birth",
      decidedBy: "Chance",
      deciderId: "chance",
      chosen: { optionId: "survives", label: "She survives the birth" },
      alternatives: [{ optionId: "dies", label: "She dies in childbirth" }],
      whyPhrase: "This was a close call.",
      probabilities: { survives: 0.81, dies: 0.19 },
    },
  },
  {
    id: "e18",
    year: 1526,
    level: 2,
    kind: "birth",
    title: "Son Cass Vell is born",
    prose: "Her son {{cass}} is born healthy, and screams loud enough to wake the tanner's dogs across the square.",
    links: [{ personId: "cass", name: "Cass Vell" }],
  },
  {
    id: "e19",
    year: 1528,
    endYear: 1532,
    level: 2,
    kind: "period",
    title: "A steady practice",
    prose: "Her practice as a healer grows steadily through the children's early years; she trains a young apprentice of her own, and Tomas's cart route now runs as far as Ashford.",
    links: [],
  },
  {
    id: "e20",
    year: 1533,
    level: 1,
    kind: "family",
    title: "Her father's health fails",
    prose: "{{joren}} can no longer manage the smithy alone; Elin visits every week with a tincture for his chest.",
    links: [{ personId: "joren", name: "Joren Marrow" }],
  },
  {
    id: "e21",
    year: 1535,
    level: 2,
    kind: "death",
    title: "Her father Joren dies",
    prose: "{{joren}} dies quietly in his sleep, the smithy cold beside him. Elin sits with the body until dawn.",
    links: [{ personId: "joren", name: "Joren Marrow" }],
  },
  {
    id: "e22",
    year: 1536,
    level: 3,
    kind: "grief",
    title: "Decides how to carry her father's death",
    prose: "A year on, the loss still sits in her chest like a stone. She has to decide what to do with it.",
    links: [],
    turn: {
      decisionId: "dec-1536-grief",
      decidedBy: "Her choice",
      deciderId: "self",
      chosen: { optionId: "harden", label: "She hardens herself against future loss" },
      alternatives: [
        { optionId: "grieve-openly", label: "She grieves openly, and lets the village see it" },
        { optionId: "cling-mother", label: "She clings to her mother instead" },
      ],
      whyPhrase: "Either path was plausible.",
      probabilities: { harden: 0.4, "grieve-openly": 0.36, "cling-mother": 0.24 },
    },
    cause: { entryId: "e21", phrase: "her father's death", year: 1535 },
  },
  {
    id: "e23",
    year: 1538,
    level: 1,
    kind: "family",
    title: "Teaches Wren to read",
    prose: "She teaches {{wren}} her letters from the same water-stained psalter Margit once used on her.",
    links: [{ personId: "wren", name: "Wren Vell" }],
  },
  {
    id: "e24",
    year: 1540,
    level: 2,
    kind: "apprenticeship",
    title: "Cass Vell apprentices as a smith",
    prose: "{{cass}} apprentices at his late grandfather's forge, reopened under a cousin's name.",
    links: [{ personId: "cass", name: "Cass Vell" }],
  },
  {
    id: "e25",
    year: 1542,
    level: 3,
    kind: "departure",
    title: "Wren Vell decides whether to leave for the city",
    prose: "{{wren}}, twenty-two now, is offered an apothecary's position in Ashford — a real trade, and real coin, far from Hallowmere.",
    links: [{ personId: "wren", name: "Wren Vell" }],
    turn: {
      decisionId: "dec-1542-wren-leaves",
      decidedBy: "Wren Vell's choice",
      deciderId: "wren",
      chosen: { optionId: "stays", label: "She stays in Hallowmere, at her mother's side" },
      alternatives: [{ optionId: "leaves", label: "She leaves for Ashford" }],
      whyPhrase: "It was closer than it looked.",
      probabilities: { stays: 0.53, leaves: 0.47 },
    },
  },
  {
    id: "e26",
    year: 1544,
    level: 1,
    kind: "village",
    title: "Trains her third apprentice",
    prose: "She takes on her third apprentice in as many decades, a quiet boy who reminds her of no one so much as herself at that age.",
    links: [],
  },
  {
    id: "e27",
    year: 1546,
    level: 2,
    kind: "illness",
    title: "Tomas Vell falls ill",
    prose: "{{tomas}}'s cough turns to something worse over a hard winter. She treats her own husband for the first time in thirty years of marriage.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
  },
  {
    id: "e28",
    year: 1547,
    level: 3,
    kind: "illness",
    title: "Tomas Vell's illness reaches its worst",
    prose: "The fever breaks one way or the other tonight, and there's nothing left in her stores that hasn't already been tried.",
    links: [],
    turn: {
      decisionId: "dec-1547-tomas-fever",
      decidedBy: "Chance",
      deciderId: "chance",
      chosen: { optionId: "recovers", label: "Tomas recovers" },
      alternatives: [{ optionId: "dies", label: "Tomas dies" }],
      whyPhrase: "This was a close call.",
      probabilities: { recovers: 0.68, dies: 0.32 },
    },
    cause: { entryId: "e27", phrase: "Tomas Vell's illness", year: 1546 },
  },
  {
    id: "e29",
    year: 1549,
    level: 1,
    kind: "family",
    title: "A quiet decade begins",
    prose: "{{tomas}} sells the cart route to a younger man and takes up woodworking instead, closer to home.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
  },
  {
    id: "e30",
    year: 1550,
    level: 2,
    kind: "reconciliation",
    title: "Hollis Fairwind seeks her out",
    prose: "{{hollis}}, who she has not spoken to since a girlhood grudge over a stolen suitor, appears at her door asking for a remedy for his wife.",
    links: [{ personId: "hollis", name: "Hollis Fairwind" }],
  },
  {
    id: "e31",
    year: 1551,
    level: 3,
    kind: "reconciliation",
    title: "Decides what to do with an old grudge",
    prose: "Forty years is a long time to hold a grudge, and Hollis is standing in front of her, hat in hand.",
    links: [{ personId: "hollis", name: "Hollis Fairwind" }],
    turn: {
      decisionId: "dec-1551-grudge",
      decidedBy: "Her choice",
      deciderId: "self",
      chosen: { optionId: "reconcile", label: "She makes peace with Hollis Fairwind" },
      alternatives: [{ optionId: "take-to-grave", label: "She sends him away, unforgiven" }],
      whyPhrase: "She almost chose otherwise.",
      probabilities: { reconcile: 0.58, "take-to-grave": 0.42 },
    },
    cause: { entryId: "e30", phrase: "Hollis Fairwind seeking her out", year: 1550 },
  },
  {
    id: "e32",
    year: 1552,
    level: 1,
    kind: "village",
    title: "Hands the healer's house to her apprentice",
    prose: "Her hands aren't as steady as they were. She begins handing the harder cases to her apprentice, and keeps the simple ones for herself.",
    links: [],
  },
  {
    id: "e33",
    year: 1553,
    level: 2,
    kind: "reflection",
    title: "Makes her peace with what's coming",
    prose: "She sits with {{tomas}} on the bench outside the healer's house most evenings now, and finds she isn't afraid of what's coming.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
  },
  {
    id: "e34",
    year: 1554,
    level: 3,
    kind: "death",
    title: "Elin Marrow's life reaches its end",
    prose: "In her sixty-fourth year, in the same house where she delivered half of Hallowmere, Elin Marrow's own body finally gives out.",
    links: [],
    turn: {
      decisionId: "dec-1554-death",
      decidedBy: "Chance",
      deciderId: "chance",
      chosen: { optionId: "dies", label: "She dies of old age" },
      alternatives: [{ optionId: "survives", label: "She survives this year" }],
      whyPhrase: "This was a fairly likely outcome.",
      probabilities: { dies: 0.74, survives: 0.26 },
    },
  },
];

const elinSummary =
  "Elin Marrow died at sixty-four in Hallowmere, the town where she was born. She spent nearly fifty years as its healer, trained three apprentices, and never once left the village where her mother taught her to read. {{tomas}} outlived her by three winters.";

const elinEpilogueOriginal = [
  "After her death, {{wren}} took over the healer's house, the fourth generation of women to run it in living memory.",
  "{{tomas}} kept the bench outside the healer's house until he died, and was buried beside her.",
];

// --- Elin Marrow — the "Changed in 1516" branch (rewrite demo) -----------------------------

const elinEntriesChanged1516: AuthoredEntry[] = [
  ...elinEntriesOriginal.slice(0, 11), // e01..e11, unchanged up to the 1516 turn
  {
    id: "e12b",
    year: 1516,
    level: 3,
    kind: "marriage",
    title: "Decides whether to marry Tomas Vell",
    prose: "{{tomas}} asks her to marry him. Margit is aging, and the healer's house will need someone to run it outright, married or not.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
    turn: {
      decisionId: "dec-1516-marry",
      decidedBy: "Her choice",
      deciderId: "self",
      chosen: { optionId: "stay-unmarried", label: "She stays unmarried, devoted to the healer's trade" },
      alternatives: [{ optionId: "marry", label: "She marries Tomas Vell" }],
      whyPhrase: "She almost chose otherwise.",
      probabilities: { marry: 0.71, "stay-unmarried": 0.29 },
    },
  },
  {
    id: "e13b",
    year: 1517,
    level: 1,
    kind: "apprenticeship",
    title: "Devotes herself fully to the healer's trade",
    prose: "With no household of her own to run, she gives every waking hour to the healer's trade, and Margit begins calling her a partner rather than an apprentice.",
    links: [],
  },
  {
    id: "e15b",
    year: 1519,
    level: 2,
    kind: "apprenticeship",
    title: "Takes on her own apprentice",
    prose: "She takes on her own first apprentice, a sharp-tongued girl named Sela, years before Margit expected her to be ready.",
    links: [],
  },
  {
    id: "e16b",
    year: 1521,
    level: 3,
    kind: "courtship",
    title: "Tomas Vell decides what to do next",
    prose: "{{tomas}} has waited five years. Mireille Cade's cousin, once passed over, is still unmarried and still in Ashford.",
    links: [{ personId: "tomas", name: "Tomas Vell" }],
    turn: {
      decisionId: "dec-1521-tomas-moves-on",
      decidedBy: "Tomas Vell's choice",
      deciderId: "tomas",
      chosen: { optionId: "courts-other", label: "He courts and marries the Ashford girl instead" },
      alternatives: [{ optionId: "waits", label: "He keeps waiting for Elin" }],
      whyPhrase: "This was a fairly clear-cut choice.",
      probabilities: { "courts-other": 0.66, waits: 0.34 },
    },
  },
  {
    id: "e18b",
    year: 1524,
    level: 1,
    kind: "village",
    title: "Her reputation grows beyond Hallowmere",
    prose: "Word of her steady hands reaches beyond Hallowmere; a farmer from two villages over rides in just to have her look at his son's leg.",
    links: [],
  },
  {
    id: "e19b",
    year: 1528,
    endYear: 1533,
    level: 2,
    kind: "period",
    title: "The healer's house becomes known",
    prose: "The healer's house becomes known well beyond the village; she trains three more apprentices in as many years, and turns the smallest room into a proper dispensary.",
    links: [],
  },
  {
    id: "e20b",
    year: 1535,
    level: 2,
    kind: "death",
    title: "Margit Holt dies",
    prose: "{{margit}}, long retired, dies in her sleep at the house she gave to Elin thirteen years before.",
    links: [{ personId: "margit", name: "Margit Holt" }],
  },
  {
    id: "e21b",
    year: 1536,
    level: 3,
    kind: "grief",
    title: "Decides how to carry Margit's death",
    prose: "Margit taught her everything, and now there's no one left who remembers Elin as anything other than the healer.",
    links: [],
    turn: {
      decisionId: "dec-1536b-grief",
      decidedBy: "Her choice",
      deciderId: "self",
      chosen: { optionId: "grieve-openly", label: "She grieves openly, and closes the house for a week" },
      alternatives: [
        { optionId: "harden", label: "She hardens herself and works through it" },
        { optionId: "cling-mother", label: "She clings to her mother instead" },
      ],
      whyPhrase: "Either path was plausible.",
      probabilities: { harden: 0.4, "grieve-openly": 0.36, "cling-mother": 0.24 },
    },
    cause: { entryId: "e20b", phrase: "Margit Holt's death", year: 1535 },
  },
  {
    id: "e24b",
    year: 1540,
    level: 1,
    kind: "village",
    title: "Sela takes her own apprentice",
    prose: "Sela, her first apprentice, takes on an apprentice of her own — the healer's house now runs three generations deep, none of them kin.",
    links: [],
  },
  {
    id: "e30b",
    year: 1550,
    level: 2,
    kind: "reconciliation",
    title: "Hollis Fairwind seeks her out",
    prose: "{{hollis}}, who she has not spoken to since a girlhood grudge, appears at her door asking for a remedy for his wife.",
    links: [{ personId: "hollis", name: "Hollis Fairwind" }],
  },
  {
    id: "e31b",
    year: 1551,
    level: 3,
    kind: "reconciliation",
    title: "Decides what to do with an old grudge",
    prose: "Forty years is a long time to hold a grudge, and Hollis is standing in front of her, hat in hand.",
    links: [{ personId: "hollis", name: "Hollis Fairwind" }],
    turn: {
      decisionId: "dec-1551b-grudge",
      decidedBy: "Her choice",
      deciderId: "self",
      chosen: { optionId: "reconcile", label: "She makes peace with Hollis Fairwind" },
      alternatives: [{ optionId: "take-to-grave", label: "She sends him away, unforgiven" }],
      whyPhrase: "She almost chose otherwise.",
      probabilities: { reconcile: 0.58, "take-to-grave": 0.42 },
    },
    cause: { entryId: "e30b", phrase: "Hollis Fairwind seeking her out", year: 1550 },
  },
  {
    id: "e33b",
    year: 1558,
    level: 2,
    kind: "reflection",
    title: "Makes her peace with what's coming",
    prose: "She sits alone on the bench outside the healer's house most evenings now, and finds she isn't afraid of what's coming.",
    links: [],
  },
  {
    id: "e34b",
    year: 1560,
    level: 3,
    kind: "death",
    title: "Elin Marrow's life reaches its end",
    prose: "In her seventieth year, in the house she never once shared with a husband, Elin Marrow's own body finally gives out.",
    links: [],
    turn: {
      decisionId: "dec-1560-death",
      decidedBy: "Chance",
      deciderId: "chance",
      chosen: { optionId: "dies", label: "She dies of old age" },
      alternatives: [{ optionId: "survives", label: "She survives this year" }],
      whyPhrase: "This was a fairly likely outcome.",
      probabilities: { dies: 0.7, survives: 0.3 },
    },
  },
];

const elinSummaryChanged =
  "Elin Marrow died at seventy in Hallowmere, the town where she was born. She spent over fifty years as its healer, trained four apprentices, and never married. The healer's house she built outlived her by generations.";

const elinEpilogueChanged = ["After her death, Sela's own apprentice took over the healer's house, the third generation to run it with none of them kin to Elin at all."];

export const elinCast = [
  { personId: "petra", name: "Petra Marrow", relation: "mother" },
  { personId: "joren", name: "Joren Marrow", relation: "father" },
  { personId: "margit", name: "Margit Holt", relation: "mentor" },
  { personId: "mireille", name: "Mireille Cade", relation: "childhood friend" },
  { personId: "tomas", name: "Tomas Vell", relation: "husband" },
  { personId: "wren", name: "Wren Vell", relation: "daughter" },
  { personId: "cass", name: "Cass Vell", relation: "son" },
  { personId: "hollis", name: "Hollis Fairwind", relation: "old rival" },
] as const;


const elinVillage: LifeScene["village"] = [
  { k: "v-ansel", b: 1470 },
  { k: "v-brida", b: 1488, d: 1531.4 },
  { k: "v-corin", b: 1495 },
  { k: "v-dorcas", b: 1510.3, d: 1548.6 },
  { k: "v-edda", b: 1522.5 },
];

// --- Night-sky scenes (hand-authored; times are fractional years) -------------------------------

const elinPeople = (died: Record<string, number>): ScenePerson[] => [
  person("protagonist", "Elin Marrow", "f", "self", "self", 1490, 1490.3),
  person("petra", "Petra Marrow", "f", "parent", "parents", 1465, 1490.3),
  person("joren", "Joren Marrow", "m", "parent", "parents", 1462, 1490.3, died.joren),
  person("margit", "Margit Holt", "f", "friend", "others", 1450, 1500.2, died.margit),
  person("mireille", "Mireille Cade", "f", "friend", "others", 1490, 1502.4),
  person("tomas", "Tomas Vell", "m", "lover", "others", 1488, 1508.5),
  person("hollis", "Hollis Fairwind", "m", "rival", "others", 1486, 1530.3),
];

const elinSceneOriginal: LifeScene = {
  people: [
    ...elinPeople({ joren: 1535.4 }).map((p) => (p.id === "tomas" ? { ...p, relCode: "spouse" as const, group: "spouses" as const } : p)),
    person("wren", "Wren Vell", "f", "child", "children", 1520, 1520.3),
    person("cass", "Cass Vell", "m", "child", "children", 1526, 1526.2),
  ].sort((a, b) => a.appearsAt - b.appearsAt),
  edges: [
    edge("petra", "protagonist", "parent", 1490.3),
    edge("joren", "protagonist", "parent", 1490.3),
    edge("petra", "joren", "spouse", null, 1535.4),
    edge("protagonist", "margit", "friend", 1500.2, 1522.8),
    edge("protagonist", "mireille", "friend", 1502.4),
    edge("protagonist", "tomas", "lover", 1512.3, 1517.5),
    edge("protagonist", "tomas", "spouse", 1517.5),
    edge("protagonist", "hollis", "rival", 1530.3, 1551.4),
    edge("protagonist", "wren", "parent", 1520.3),
    edge("tomas", "wren", "parent", 1520.3),
    edge("protagonist", "cass", "parent", 1526.2),
    edge("tomas", "cass", "parent", 1526.2),
  ],
  village: elinVillage,
  bands: [],
  span: { start: 1490.3, end: 1554.6 },
};

const elinSceneChanged: LifeScene = {
  people: elinPeople({ margit: 1535.3 }),
  edges: [
    edge("petra", "protagonist", "parent", 1490.3),
    edge("joren", "protagonist", "parent", 1490.3),
    edge("petra", "joren", "spouse", null),
    edge("protagonist", "margit", "friend", 1500.2),
    edge("protagonist", "mireille", "friend", 1502.4),
    edge("protagonist", "tomas", "lover", 1512.3, 1521.6),
    edge("protagonist", "hollis", "rival", 1530.3, 1551.4),
  ],
  village: elinVillage,
  bands: [],
  span: { start: 1490.3, end: 1560.6 },
};

const rosalindScene: LifeScene = {
  people: [
    person("protagonist", "Rosalind Thorn", "f", "self", "self", 1602, 1602.4),
    person("elowen", "Elowen Thorn", "f", "parent", "parents", 1578, 1602.4),
    person("bram", "Bram Thorn", "m", "parent", "parents", 1576, 1602.4),
    person("sable", "Sable Underhill", "f", "friend", "others", 1602, 1605.4),
  ],
  edges: [edge("elowen", "protagonist", "parent", 1602.4), edge("bram", "protagonist", "parent", 1602.4), edge("elowen", "bram", "spouse", null), edge("protagonist", "sable", "friend", 1605.4)],
  village: [{ k: "v-fenn", b: 1590 }, { k: "v-gale", b: 1599, d: 1606.5 }, { k: "v-hale", b: 1603.2 }],
  bands: [],
  span: { start: 1602.4, end: 1608.5 },
};

function chronicle(branch: BranchInfo, authored: readonly AuthoredEntry[], scene: LifeScene, summary: string, epilogue: readonly string[]): Chronicle {
  const entries = withTiming(authored, scene);
  return {
    lifeId: "life-elin",
    branchId: branch.branchId,
    villageName: "Hallowmere",
    protagonist: {
      name: "Elin Marrow",
      sex: "f",
      birthYear: 1490,
      deathYear: entries[entries.length - 1].year,
      ageAtDeath: entries[entries.length - 1].year - 1490,
      causeOfDeath: branch.branchId === ORIGINAL.branchId ? "old age" : "old age, unmarried",
    },
    summary: branch.branchId === ORIGINAL.branchId ? elinSummary : elinSummaryChanged,
    summaryLinks: [
      { personId: "tomas", name: "Tomas Vell" },
      { personId: "wren", name: "Wren Vell" },
    ],
    epilogue,
    entries,
    scene,
    branches: [ORIGINAL, CHANGED_1516],
    cast: elinCast.map((c) => ({ personId: c.personId, name: c.name, relation: c.relation })),
  };
}

export const elinChronicles: Readonly<Record<string, Chronicle>> = {
  [ORIGINAL.branchId]: chronicle(ORIGINAL, elinEntriesOriginal, elinSceneOriginal, elinSummary, elinEpilogueOriginal),
  [CHANGED_1516.branchId]: chronicle(CHANGED_1516, elinEntriesChanged1516, elinSceneChanged, elinSummaryChanged, elinEpilogueChanged),
};

// --- Rosalind Thorn — a short, early-death life --------------------------------------------

const ROSALIND_BRANCH: BranchInfo = { branchId: "branch-original", label: "Original life", parentBranchId: null, forkYear: null };

const rosalindEntries: AuthoredEntry[] = [
  {
    id: "r01",
    year: 1602,
    level: 2,
    kind: "birth",
    title: "Rosalind Thorn is born",
    prose: "Rosalind Thorn is born in Ashcombe, a late and much-wanted child to {{elowen}} and {{bram}}.",
    links: [
      { personId: "elowen", name: "Elowen Thorn" },
      { personId: "bram", name: "Bram Thorn" },
    ],
  },
  {
    id: "r02",
    year: 1603,
    level: 1,
    kind: "childhood",
    title: "Takes her first steps",
    prose: "She takes her first steps in the garden behind the cottage, watched over by {{elowen}}.",
    links: [{ personId: "elowen", name: "Elowen Thorn" }],
  },
  {
    id: "r03",
    year: 1604,
    level: 1,
    kind: "childhood",
    title: "Speaks her first full sentence",
    prose: "Her first full sentence is a complaint about the goat, delivered to {{bram}} with great seriousness.",
    links: [{ personId: "bram", name: "Bram Thorn" }],
  },
  {
    id: "r04",
    year: 1605,
    level: 2,
    kind: "friendship",
    title: "Befriends Sable Underhill",
    prose: "She befriends {{sable}}, the miller's youngest, and the two are rarely seen apart at the village green.",
    links: [{ personId: "sable", name: "Sable Underhill" }],
  },
  {
    id: "r05",
    year: 1606,
    level: 3,
    kind: "illness",
    title: "Catches a fever",
    prose: "A fever takes hold of her over three cold days in early spring. {{elowen}} sits up with her every night.",
    links: [{ personId: "elowen", name: "Elowen Thorn" }],
    turn: {
      decisionId: "dec-1606-fever",
      decidedBy: "Chance",
      deciderId: "chance",
      chosen: { optionId: "recovers", label: "She recovers" },
      alternatives: [{ optionId: "dies", label: "The fever takes her" }],
      whyPhrase: "This was a close call.",
      probabilities: { recovers: 0.58, dies: 0.42 },
    },
  },
  {
    id: "r06",
    year: 1607,
    level: 1,
    kind: "childhood",
    title: "A quiet, ordinary year",
    prose: "A quiet year follows. She and {{sable}} spend it building a fort out of driftwood by the river.",
    links: [{ personId: "sable", name: "Sable Underhill" }],
  },
  {
    id: "r07",
    year: 1608,
    level: 3,
    kind: "death",
    title: "Rosalind Thorn's life reaches its end",
    prose: "A winter fever returns, harder this time. On the sixth night, Rosalind Thorn's small body cannot fight it any further.",
    links: [],
    turn: {
      decisionId: "dec-1608-death",
      decidedBy: "Chance",
      deciderId: "chance",
      chosen: { optionId: "dies", label: "She dies of a winter fever" },
      alternatives: [{ optionId: "survives", label: "She recovers, and lives on" }],
      whyPhrase: "It could easily have gone otherwise.",
      probabilities: { dies: 0.54, survives: 0.46 },
    },
  },
];

const rosalindSummary = "Rosalind Thorn died in Ashcombe at just six years old, taken by a winter fever. She never left the village where she was born, and is remembered there still as the girl who built driftwood forts by the river.";

const rosalindEpilogue = ["After her death, {{elowen}} and {{bram}} never had another child.", "The village planted a rowan tree by the river in her memory."];

export const rosalindCast = [
  { personId: "elowen", name: "Elowen Thorn", relation: "mother" },
  { personId: "bram", name: "Bram Thorn", relation: "father" },
  { personId: "sable", name: "Sable Underhill", relation: "best friend" },
] as const;

export const rosalindChronicle: Chronicle = {
  lifeId: "life-rosalind",
  branchId: ROSALIND_BRANCH.branchId,
  villageName: "Ashcombe",
  protagonist: { name: "Rosalind Thorn", sex: "f", birthYear: 1602, deathYear: 1608, ageAtDeath: 6, causeOfDeath: "a winter fever" },
  summary: rosalindSummary,
  summaryLinks: [
    { personId: "elowen", name: "Elowen Thorn" },
    { personId: "bram", name: "Bram Thorn" },
  ],
  epilogue: rosalindEpilogue,
  entries: withTiming(rosalindEntries, rosalindScene),
  scene: rosalindScene,
  branches: [ROSALIND_BRANCH],
  cast: rosalindCast.map((c) => ({ personId: c.personId, name: c.name, relation: c.relation })),
};

// --- Person sheets ---------------------------------------------------------------------------

export const personSheets: Readonly<Record<string, PersonSheet>> = {
  "life-elin:petra": {
    personId: "petra",
    name: "Petra Marrow",
    relation: "mother",
    birthYear: 1468,
    deathYear: 1541,
    job: "weaver",
    blurb: "Elin's mother, a weaver who never left Hallowmere. She sat with Elin through the winter fever of 1504 and never spoke of how close it came.",
    moments: [
      { year: 1490, title: "Elin Marrow is born" },
      { year: 1504, title: "Sits up with Elin through the fever" },
      { year: 1541, title: "Dies in Hallowmere" },
    ],
  },
  "life-elin:joren": {
    personId: "joren",
    name: "Joren Marrow",
    relation: "father",
    birthYear: 1465,
    deathYear: 1535,
    job: "blacksmith",
    blurb: "Elin's father, the village blacksmith. His failing health in his last years brought Elin back to the smithy every week.",
    moments: [
      { year: 1490, title: "Elin Marrow is born" },
      { year: 1533, title: "His health fails" },
      { year: 1535, title: "Dies in his sleep" },
    ],
  },
  "life-elin:margit": {
    personId: "margit",
    name: "Margit Holt",
    relation: "mentor",
    birthYear: 1460,
    deathYear: 1540,
    job: "healer",
    blurb: "The village healer who apprenticed Elin as a girl and eventually gave her the healer's house outright.",
    moments: [
      { year: 1500, title: "Takes Elin on to fetch herbs" },
      { year: 1506, title: "Formally apprentices Elin" },
      { year: 1522, title: "Retires, leaving the house to Elin" },
    ],
  },
  "life-elin:mireille": {
    personId: "mireille",
    name: "Mireille Cade",
    relation: "childhood friend",
    birthYear: 1490,
    deathYear: null,
    job: "tanner",
    blurb: "Elin's childhood friend, the tanner's daughter, who traded secrets with her at the well.",
    moments: [{ year: 1502, title: "Befriends Elin at the well" }],
  },
  "life-elin:tomas": {
    personId: "tomas",
    name: "Tomas Vell",
    relation: "husband",
    birthYear: 1488,
    deathYear: null,
    job: "carter",
    blurb: "A carter's son from Ashford who chose to court Elin over her rival, and married her a few years later.",
    moments: [
      { year: 1508, title: "Meets Elin" },
      { year: 1512, title: "Chooses to court her" },
      { year: 1517, title: "Marries her at midsummer" },
    ],
  },
  "life-elin:wren": {
    personId: "wren",
    name: "Wren Vell",
    relation: "daughter",
    birthYear: 1520,
    deathYear: null,
    job: "healer's apprentice",
    blurb: "Elin's eldest child, who chose to stay in Hallowmere at her mother's side rather than take an apothecary's post in Ashford.",
    moments: [
      { year: 1520, title: "Is born" },
      { year: 1542, title: "Chooses to stay in Hallowmere" },
    ],
  },
  "life-elin:cass": {
    personId: "cass",
    name: "Cass Vell",
    relation: "son",
    birthYear: 1526,
    deathYear: null,
    job: "smith",
    blurb: "Elin's younger child, who apprenticed at his late grandfather's forge.",
    moments: [
      { year: 1526, title: "Is born" },
      { year: 1540, title: "Apprentices as a smith" },
    ],
  },
  "life-elin:hollis": {
    personId: "hollis",
    name: "Hollis Fairwind",
    relation: "old rival",
    birthYear: 1489,
    deathYear: null,
    job: "farmer",
    blurb: "A girlhood rival over a stolen suitor, decades gone cold, who sought Elin out for a remedy and left with a truce.",
    moments: [{ year: 1550, title: "Seeks out Elin after forty years" }],
  },
  "life-rosalind:elowen": {
    personId: "elowen",
    name: "Elowen Thorn",
    relation: "mother",
    birthYear: 1578,
    deathYear: null,
    job: "seamstress",
    blurb: "Rosalind's mother, who sat up with her through both fevers and never had another child after losing her.",
    moments: [
      { year: 1602, title: "Rosalind Thorn is born" },
      { year: 1606, title: "Sits up through the first fever" },
    ],
  },
  "life-rosalind:bram": {
    personId: "bram",
    name: "Bram Thorn",
    relation: "father",
    birthYear: 1575,
    deathYear: null,
    job: "cooper",
    blurb: "Rosalind's father, a cooper in Ashcombe, who planted the rowan tree by the river in her memory.",
    moments: [{ year: 1602, title: "Rosalind Thorn is born" }],
  },
  "life-rosalind:sable": {
    personId: "sable",
    name: "Sable Underhill",
    relation: "best friend",
    birthYear: 1601,
    deathYear: null,
    job: "miller's child",
    blurb: "The miller's youngest, and Rosalind's inseparable friend for the whole of her short life.",
    moments: [
      { year: 1605, title: "Befriends Rosalind" },
      { year: 1607, title: "Builds a driftwood fort with her" },
    ],
  },
};

export const livesList: readonly LifeListItem[] = [
  { lifeId: "life-elin", name: "Elin Marrow", birthYear: 1490, deathYear: 1554, ageAtDeath: 64, causeOfDeath: "old age", branchCount: 2 },
  { lifeId: "life-rosalind", name: "Rosalind Thorn", birthYear: 1602, deathYear: 1608, ageAtDeath: 6, causeOfDeath: "a winter fever", branchCount: 1 },
];
