import { describe, expect, it } from "vitest";
import { createMind } from "@/domain/mind";
import type { Bond } from "@/domain/mind";
import type { Event, Person, YearSnapshot } from "@/domain/types";
import { createSceneTracker, friendSeenBefore, sceneForBranch } from "./life-scene";
import { deleteLife, getLifeBranch, registerLife, registerLifeBranch } from "./life-store";

const SEED = "scene-tracker";

function person(id: string, birthYear: number, friends: readonly string[] = []): Person {
  const mind = createMind(SEED, id, birthYear);
  mind.relationships = friends.map((personId) => ({ personId, bond: "friend" as Bond, strength: 60 }));
  return { id, name: id.toUpperCase(), sex: "f", birthYear, mind } as unknown as Person;
}

function snapshot(year: number, friends: Record<string, number>, extra: readonly Event[] = []): YearSnapshot {
  const ids = Object.keys(friends);
  const people: Record<string, Person> = { protagonist: person("protagonist", 1330, ids.filter((id) => friends[id]! <= year)) };
  for (const id of ids) people[id] = person(id, friends[id]!);
  const events: Event[] = [{ id: "b", year: 1330, kind: "birth", actors: ["protagonist"], payload: {}, causes: [] }, ...extra];
  return { year, people, events, decisions: [] };
}

const friendEdge = (scene: ReturnType<ReturnType<typeof createSceneTracker>["scene"]>, id: string) => scene.edges.find((e) => e.kind === "friend" && e.b === id);

describe("createSceneTracker — friend edges", () => {
  it("starts a friend edge at the first snapshot year the bond exists", () => {
    const tracker = createSceneTracker({ seed: SEED, protagonistId: "protagonist" });
    for (let year = 1330; year <= 1340; year++) tracker.observe(snapshot(year, { pal: 1335 }));
    expect(friendEdge(tracker.scene(), "pal")).toMatchObject({ fromAt: 1335 });
  });

  it("ends the edge the year after the bond was last seen once it is dropped", () => {
    const tracker = createSceneTracker({ seed: SEED, protagonistId: "protagonist" });
    for (let year = 1330; year <= 1338; year++) tracker.observe(snapshot(year, year <= 1336 ? { pal: 1335 } : { pal: 1400 }));
    expect(friendEdge(tracker.scene(), "pal")).toMatchObject({ fromAt: 1335, untilAt: 1337 });
  });

  it("is a superset when read later: earlier friends keep their start", () => {
    const tracker = createSceneTracker({ seed: SEED, protagonistId: "protagonist" });
    tracker.observe(snapshot(1335, { pal: 1335 }));
    const early = friendEdge(tracker.scene(), "pal")!;
    tracker.observe(snapshot(1340, { pal: 1335, other: 1340 }));
    const late = tracker.scene();
    expect(friendEdge(late, "pal")).toEqual(early);
    expect(friendEdge(late, "other")).toMatchObject({ fromAt: 1340 });
  });
});

describe("createSceneTracker — monotone scene", () => {
  it("never evicts a friend shown earlier when more friends than the cap arrive", () => {
    const tracker = createSceneTracker({ seed: SEED, protagonistId: "protagonist" });
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const shown = new Set<string>();
    ids.forEach((id, i) => {
      const friends: Record<string, number> = {};
      for (const x of ids.slice(0, i + 1)) friends[x] = 1330;
      // The oldest friend is dropped once the eighth arrives; the others stay.
      if (i >= 7) friends.a = 1400; // still a person, no longer a friend
      tracker.observe(snapshot(1331 + i, friends));
      const scene = tracker.scene();
      const present = new Set(scene.people.map((p) => p.id));
      for (const id of shown) expect(present.has(id)).toBe(true);
      for (const p of scene.people) shown.add(p.id);
    });
  });
});

describe("createSceneTracker — rewrite branch fallback", () => {
  const fork = { forkYear: 1350 };

  it("uses the parent branch's first-seen year for a bond that predates the fork", () => {
    const tracker = createSceneTracker({ seed: SEED, protagonistId: "protagonist", fork: { ...fork, priorSeen: new Map([["pal", 1336]]) } });
    tracker.observe(snapshot(1350, { pal: 1335 }));
    expect(friendEdge(tracker.scene(), "pal")).toMatchObject({ fromAt: 1336 });
  });

  it("falls back to the earliest shared event when the parent has no data", () => {
    const shared: Event = { id: "s", year: 1342, kind: "romance", actors: ["protagonist", "pal"], payload: {}, causes: [] };
    const tracker = createSceneTracker({ seed: SEED, protagonistId: "protagonist", fork });
    tracker.observe(snapshot(1350, { pal: 1335 }, [shared]));
    expect(friendEdge(tracker.scene(), "pal")).toMatchObject({ fromAt: 1342 });
  });

  it("then to the later of the two births, and null when that is the protagonist's own", () => {
    const tracker = createSceneTracker({ seed: SEED, protagonistId: "protagonist", fork });
    tracker.observe(snapshot(1350, { late: 1340, early: 1325 }));
    const scene = tracker.scene();
    expect(friendEdge(scene, "late")).toMatchObject({ fromAt: 1340 });
    expect(friendEdge(scene, "early")).toMatchObject({ fromAt: null });
  });

  it("starts a bond first seen after the fork at its own snapshot year", () => {
    const tracker = createSceneTracker({ seed: SEED, protagonistId: "protagonist", fork: { ...fork, priorSeen: new Map() } });
    tracker.observe(snapshot(1350, {}));
    tracker.observe(snapshot(1355, { pal: 1355 }));
    expect(friendEdge(tracker.scene(), "pal")).toMatchObject({ fromAt: 1355 });
  });
});

describe("friendSeenBefore / sceneForBranch — through the branch chain", () => {
  function register(lifeId: string) {
    const snapshots = new Map<number, YearSnapshot>();
    for (let year = 1330; year <= 1345; year++) snapshots.set(year, snapshot(year, { pal: 1335 }));
    const last = snapshots.get(1345)!;
    const result = { config: { seed: SEED, startYear: 1327, endYear: 1427, town: { name: "Testford" } }, people: last.people, events: last.events, decisions: [] };
    registerLife(lifeId, "root", result.config as never, "P", "f", result as never, snapshots);
    return result;
  }

  it("reports undefined for an unknown branch and ignores years from the fork on", () => {
    const lifeId = "scene-chain-a";
    register(lifeId);
    expect(friendSeenBefore(lifeId, "nope", 1340)).toBeUndefined();
    expect(friendSeenBefore(lifeId, "root", 1340)?.get("pal")).toBe(1335);
    expect(friendSeenBefore(lifeId, "root", 1335)?.has("pal")).toBe(false);
    deleteLife(lifeId);
  });

  it("caps each ancestor at the fork year of the child it was reached through", () => {
    const lifeId = "scene-chain-c";
    const result = register(lifeId);
    const fromYear = (start: number, id: string) => {
      const snaps = new Map<number, YearSnapshot>();
      for (let year = start; year <= 1345; year++) snaps.set(year, snapshot(year, { [id]: 1330 }));
      return snaps;
    };
    // root (1330..1345, pal) <- mid forked 1340 <- leaf forked 1342
    registerLifeBranch(lifeId, "mid", "root", 1340, { id: "o", decisionId: "d", optionId: "x" }, result as never, fromYear(1340, "pal"), "Changed in 1340");
    registerLifeBranch(lifeId, "leaf", "mid", 1342, { id: "o", decisionId: "d", optionId: "x" }, result as never, fromYear(1342, "pal"), "Changed in 1342");
    // Seen from the leaf before 1344, mid only counts up to its child's fork (1342), root up to mid's fork (1340).
    const seen = friendSeenBefore(lifeId, "leaf", 1344)!;
    expect(seen.get("pal")).toBe(1335);
    const mid = getLifeBranch(lifeId, "mid")!;
    (mid.snapshots as Map<number, YearSnapshot>).set(1341, snapshot(1341, { late: 1330 }));
    (mid.snapshots as Map<number, YearSnapshot>).set(1343, snapshot(1343, { later: 1330 }));
    const capped = friendSeenBefore(lifeId, "leaf", 1344)!;
    expect(capped.get("late")).toBe(1341);
    expect(capped.has("later")).toBe(false);
    const root = getLifeBranch(lifeId, "root")!;
    (root.snapshots as Map<number, YearSnapshot>).set(1341, snapshot(1341, { overreach: 1330 }));
    expect(friendSeenBefore(lifeId, "leaf", 1344)!.has("overreach")).toBe(false);
    deleteLife(lifeId);
  });

  it("rebuilds a forked branch's friend start from its parent", () => {
    const lifeId = "scene-chain-b";
    const result = register(lifeId);
    const snapshots = new Map<number, YearSnapshot>();
    for (let year = 1340; year <= 1345; year++) snapshots.set(year, snapshot(year, { pal: 1335 }));
    registerLifeBranch(lifeId, "child", "root", 1340, { id: "o", decisionId: "d", optionId: "x" }, result as never, snapshots, "Changed in 1340");
    expect(sceneForBranch(getLifeBranch(lifeId, "child")!).edges.find((e) => e.kind === "friend")).toMatchObject({ fromAt: 1335 });
    deleteLife(lifeId);
  });
});
