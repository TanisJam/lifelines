import { describe, expect, it } from "vitest";
import { fixtureChronicle } from "@/lib/fixtures";
import { sceneAt, yearTicks } from "@/lib/fixtures/stream";
import { stepClock } from "./clock";
import { initialRewrite, rewriteBusy, rewriteFrontier, rewriteReducer, shownChronicle, type Fork, type RewriteAction, type RewriteState } from "./rewrite";

const base = fixtureChronicle("life-elin");
const turn = base.entries.find((e) => e.turn)!;
const fork: Fork = { entryId: turn.id, year: turn.year, at: turn.at, originalLabel: turn.turn!.chosen.label, newLabel: "Another road" };
const target = fixtureChronicle("life-elin");
const ticks = yearTicks(target.entries, fork.year, Math.floor(target.scene.span.end!)).map(([year, entries]) => ({ type: "tick" as const, year, entries, scene: sceneAt(target.scene, year) }));

const run = (actions: readonly RewriteAction[], from: RewriteState = initialRewrite): RewriteState => actions.reduce(rewriteReducer, from);
const toC = (): RewriteState => run([{ type: "begin", fork }, { type: "hold" }, { type: "stream", from: base }]);

describe("rewriteReducer phases", () => {
  it("runs A, B, C, D in order", () => {
    const seen: string[] = [];
    let s = initialRewrite;
    for (const a of [{ type: "begin", fork }, { type: "hold" }, { type: "stream", from: base }, ticks[0]!, { type: "done", chronicle: target, ghosts: { [turn.id]: "Once, otherwise." } }] as RewriteAction[]) {
      s = rewriteReducer(s, a);
      seen.push(s.phase);
    }
    expect(seen).toEqual(["A", "B", "C", "C", "D"]);
    expect(rewriteBusy(s)).toBe(false);
    expect(s.ghosts[turn.id]).toBe("Once, otherwise.");
  });

  it("ignores events that arrive out of order", () => {
    expect(run([ticks[0]!]).phase).toBe("idle");
    expect(run([{ type: "stream", from: base }]).phase).toBe("idle");
    expect(run([{ type: "begin", fork }, ticks[0]!]).phase).toBe("A");
    expect(run([{ type: "begin", fork }, { type: "begin", fork: { ...fork, newLabel: "x" } }]).fork?.newLabel).toBe("Another road");
  });

  it("is busy through A, B and C only", () => {
    expect([run([{ type: "begin", fork }]), run([{ type: "begin", fork }, { type: "hold" }]), toC()].map(rewriteBusy)).toEqual([true, true, true]);
    expect(rewriteBusy(initialRewrite)).toBe(false);
  });
});

describe("the sky shown while rewriting", () => {
  it("keeps the old life through A and B, and holds the clock at the fork in B", () => {
    const a = run([{ type: "begin", fork }]);
    expect(shownChronicle(a, base)).toBe(base);
    expect(rewriteFrontier(a)).toBeUndefined();
    const b = run([{ type: "hold" }], a);
    expect(shownChronicle(b, base)).toBe(base);
    expect(rewriteFrontier(b)).toBe(fork.at);
  });

  it("C starts from the old entries before the fork year, then grows with each tick", () => {
    const c = toC();
    const kept = shownChronicle(c, base).entries;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((e) => e.year < fork.year)).toBe(true);
    expect(rewriteFrontier(c)).toBe(fork.at);

    const next = rewriteReducer(c, ticks[0]!);
    expect(rewriteFrontier(next)).toBe(fork.year + 1);
    expect(shownChronicle(next, base).scene).toBe(ticks[0]!.scene);
    expect(shownChronicle(next, base).entries.map((e) => e.id)).toEqual([...kept, ...ticks[0]!.entries].map((e) => e.id));
  });

  it("C caps the clock: it plays from the fork but never passes the frontier", () => {
    let s = toC();
    let t = fork.at;
    for (const tick of ticks.slice(0, 4)) {
      s = rewriteReducer(s, tick);
      const frontier = rewriteFrontier(s)!;
      for (let i = 0; i < 400; i++) {
        t = stepClock({ t, playing: true, speed: 4, frontier, end: 1e9 }, 0.1).t;
        expect(t).toBeLessThanOrEqual(frontier);
      }
    }
    expect(t).toBe(ticks[3]!.year + 1);
  });

  it("D shows the saved branch with the clock free to run to its end", () => {
    const d = run([{ type: "done", chronicle: target, ghosts: {} }], toC());
    expect(shownChronicle(d, base)).toBe(target);
    expect(rewriteFrontier(d)).toBeUndefined();
  });
});

describe("failure", () => {
  it("restores the old life and keeps the message", () => {
    const failed = run([ticks[0]!, { type: "fail", message: "The rewrite failed." }], toC());
    expect(failed.phase).toBe("idle");
    expect(shownChronicle(failed, base)).toBe(base);
    expect(rewriteFrontier(failed)).toBeUndefined();
    expect(failed.error).toBe("The rewrite failed.");
    expect(failed.ghosts).toEqual({});
  });

  it("a failed branch load keeps what is on show and only reports", () => {
    const settled = run([{ type: "done", chronicle: target, ghosts: { [turn.id]: "x" } }], toC());
    const failed = rewriteReducer(settled, { type: "fail", message: "Couldn't load that branch." });
    expect(failed.phase).toBe("D");
    expect(failed.ghosts).toEqual(settled.ghosts);
    expect(failed.error).toBe("Couldn't load that branch.");
  });

  it("starting again clears the message", () => {
    const failed = run([{ type: "fail", message: "boom" }], toC());
    expect(rewriteReducer(failed, { type: "begin", fork }).error).toBeNull();
  });
});

describe("switching branch", () => {
  it("shows the other branch with no ghosts, and not while a rewrite runs", () => {
    const settled = run([{ type: "done", chronicle: target, ghosts: { [turn.id]: "x" } }], toC());
    const other = rewriteReducer(settled, { type: "loaded", chronicle: base });
    expect(other.phase).toBe("idle");
    expect(shownChronicle(other, target)).toBe(base);
    expect(other.ghosts).toEqual({});
    expect(rewriteReducer(toC(), { type: "loaded", chronicle: base }).phase).toBe("C");
  });
});
