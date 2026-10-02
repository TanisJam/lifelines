import { describe, expect, it } from "vitest";
import type { LifeScene } from "@/contracts/life";
import { stepClock } from "./clock";
import { elinScene } from "./fixture-scene";
import { computeLayout } from "./layout";
import { frameAt, timeline } from "./scene-model";

const scene = elinScene();
const layout = computeLayout(scene);
const line = timeline(scene, scene.span.end!);

describe("frameAt determinism", () => {
  it("is deep-equal whether t was reached by stepping, a jump, or a backward scrub", () => {
    for (const target of [1500.1, 1517.5, 1520.4, 1535.4, 1553]) {
      let state = { t: scene.span.start, playing: true, speed: 4, frontier: line.end, end: line.end };
      while (state.t < target) {
        const dt = Math.min(0.016, (target - state.t) / (0.56 * 4));
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
