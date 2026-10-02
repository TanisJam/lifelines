import { describe, expect, it } from "vitest";
import type { LifeScene } from "@/contracts/life";
import { stepClock } from "./clock";
import { RATE } from "./constants";
import { elinScene } from "./fixture-scene";
import { computeLayout } from "./layout";
import { fixtureChronicle } from "@/lib/fixtures";
import { frameAt, timeline } from "./scene-model";
import { entryYs, tapeYs } from "./tape";
import { entryText, typed, typeParts } from "./typewriter";

const scene = elinScene();
const layout = computeLayout(scene);
const line = timeline(scene, scene.span.end!);
const speed = 4;

describe("frameAt determinism", () => {
  it("is deep-equal whether t was reached by stepping, a jump, or a backward scrub", () => {
    for (const target of [1500.1, 1517.5, 1520.4, 1535.4, 1553]) {
      let state = { t: scene.span.start, playing: true, speed, frontier: line.end, end: line.end };
      while (state.t < target) {
        const dt = Math.min(0.016, (target - state.t) / (RATE * speed));
        state = { ...state, ...stepClock(state, dt) };
        if (target - state.t < 1e-9) break;
      }
      const stepped = frameAt(scene, layout, target);
      const afterOvershoot = frameAt(scene, layout, line.end);
      const scrubbedBack = frameAt(scene, layout, target);
      expect(afterOvershoot).not.toEqual(stepped);
      expect(scrubbedBack).toEqual(stepped);
      expect(frameAt(scene, layout, state.t)).toEqual(frameAt(scene, layout, state.t));
      expect(Math.abs(state.t - target)).toBeLessThan(0.02);
    }
  });

  it("gives the same frame from a rebuilt layout (live to done does not relayout)", () => {
    expect(frameAt(scene, computeLayout(scene), 1521)).toEqual(frameAt(scene, layout, 1521));
  });

  it("keeps existing stars where they are when the scene grows", () => {
    const early: LifeScene = { ...scene, people: scene.people.filter((p) => p.appearsAt < 1510), edges: [] };
    const a = frameAt(early, computeLayout(early), 1509);
    const b = frameAt(scene, layout, 1509);
    for (const star of a.people) expect(b.people.find((p) => p.id === star.id)).toEqual(star);
  });
});

describe("reel determinism (typewriter and tape)", () => {
  const entries = fixtureChronicle("life-elin")
    .entries.filter((e) => e.kind !== "period")
    .sort((a, b) => a.at - b.at);
  const ats = entries.map((e) => e.at);
  const ys = tapeYs(ats);
  const texts = entries.map((e) => typeParts(entryText(e)));
  const reelAt = (t: number) => ({ ys: entryYs(ats, ys, t), typed: texts.map((parts, i) => typed(parts, t - entries[i]!.at)) });

  it("is deep-equal whether t was reached by stepping, a jump, or a backward scrub", () => {
    for (const target of [1490.6, 1504.55, 1517.5, 1526.6, 1554]) {
      let state = { t: scene.span.start, playing: true, speed, frontier: line.end, end: line.end };
      while (state.t < target - 1e-9) {
        state = { ...state, ...stepClock(state, Math.min(0.016, (target - state.t) / (RATE * speed))) };
      }
      const stepped = reelAt(state.t);
      const afterOvershoot = reelAt(line.end);
      expect(afterOvershoot).not.toEqual(stepped);
      expect(reelAt(state.t)).toEqual(stepped);
      expect(reelAt(target)).toEqual(reelAt(state.t));
    }
  });

  it("only ever adds characters as the clock moves forward", () => {
    let prev = reelAt(scene.span.start).typed.map((s) => s.counts.reduce((a, b) => a + b, 0));
    for (let t = scene.span.start; t <= line.end; t += 0.07) {
      const now = reelAt(t).typed.map((s) => s.counts.reduce((a, b) => a + b, 0));
      now.forEach((n, i) => expect(n).toBeGreaterThanOrEqual(prev[i]!));
      prev = now;
    }
  });
});
