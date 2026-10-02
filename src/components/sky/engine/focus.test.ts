import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elinScene } from "@/lib/sky/fixture-scene";
import { computeLayout } from "@/lib/sky/layout";
import { createPlayerStore } from "@/lib/sky/player-store";
import { frameAt } from "@/lib/sky/scene-model";
import { createFocus } from "./focus";
import { FakeEl } from "./fake-dom";

const scene = elinScene();
const layout = computeLayout(scene);
const [a, b] = scene.people;

let doc: FakeEl;
beforeEach(() => {
  doc = new FakeEl("document");
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("document", doc);
});
afterEach(() => vi.unstubAllGlobals());

function setup(activate = () => false) {
  const svg = new FakeEl("svg");
  const tipParent = new FakeEl("div");
  tipParent.rect = { left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 };
  const tip = new FakeEl("div", {}, tipParent);
  tip.hidden = true;
  const store = createPlayerStore();
  const describe = vi.fn((p: { name: string }) => ({ rel: "relation", name: p.name, sub: "details" }));
  const focus = createFocus({ svg: svg as unknown as SVGSVGElement, tip: tip as unknown as HTMLElement, scene, store, describe, activate });
  const star = (id: string) => svg.querySelector(`[data-person="${id}"]`);
  return { svg, tip, store, focus, star, describe };
}

describe("createFocus", () => {
  it("a click pins the star and its tooltip, and a second click unpins", () => {
    const { tip, star, svg } = setup();
    star(a!.id).fire("click");
    expect(tip.hidden).toBe(false);
    expect(tip.querySelector("b").textContent).toBe(a!.name);
    expect(svg.classes.has("focus")).toBe(true);
    expect(star(a!.id).classes.has("focal")).toBe(true);
    star(a!.id).fire("click");
    expect(tip.hidden).toBe(true);
    expect(svg.classes.has("focus")).toBe(false);
  });

  it("does not pin when the click was handled (the sheet opened)", () => {
    const activate = vi.fn(() => true);
    const { tip, star } = setup(activate);
    star(a!.id).fire("click");
    expect(activate).toHaveBeenCalledWith(a!.id);
    expect(tip.hidden).toBe(true);
  });

  it("a click outside the stars unpins; a click on a star does not", () => {
    const { tip, star } = setup();
    star(a!.id).fire("click");
    doc.fire("click", {}, new FakeEl("div", { "data-person": "" }));
    expect(tip.hidden).toBe(false);
    doc.fire("click", {}, new FakeEl("div"));
    expect(tip.hidden).toBe(true);
  });

  it("star focus overrides entry focus, and entry focus returns when the star lets go", () => {
    const { svg, star, focus } = setup();
    focus.setEntry([b!.id]);
    expect(star(b!.id).classes.has("hl")).toBe(true);
    star(a!.id).fire("mouseenter");
    expect(star(a!.id).classes.has("focal")).toBe(true);
    expect(star(b!.id).classes.has("focal")).toBe(false);
    focus.setEntry([b!.id, a!.id]);
    expect(star(a!.id).classes.has("focal")).toBe(true);
    star(a!.id).fire("mouseleave");
    expect(svg.classes.has("focus")).toBe(true);
    expect(star(a!.id).classes.has("hl")).toBe(true);
    expect(star(a!.id).classes.has("focal")).toBe(false);
  });

  it("hides the tooltip when no star holds focus, and clears the entry focus on null", () => {
    const { svg, tip, star, focus } = setup();
    expect(tip.hidden).toBe(true);
    star(a!.id).fire("mouseenter");
    expect(tip.hidden).toBe(false);
    star(a!.id).fire("mouseleave");
    expect(tip.hidden).toBe(true);
    focus.setEntry([b!.id]);
    expect(tip.hidden).toBe(true);
    focus.setEntry(null);
    expect(svg.classes.has("focus")).toBe(false);
  });

  it("the tooltip follows the pinned star on each frame", () => {
    const { tip, store, star } = setup();
    // A child arrives from its parent, so its resting place differs from where it is mid-arrival.
    const child = scene.people.find((p) => p.group === "children")!;
    star(child.id).fire("click");
    const at = (t: number) => {
      store.emitFrame(frameAt(scene, layout, t));
      return [tip.style.left, tip.style.top];
    };
    const early = at(child.appearsAt + 0.1);
    const late = at(scene.span.end! - 1);
    expect(early).not.toEqual(late);
  });

  it("destroy removes the document listener and every star listener", () => {
    const { star, focus } = setup();
    expect(doc.listenerCount()).toBe(1);
    focus.destroy();
    expect(doc.listenerCount()).toBe(0);
    scene.people.forEach((p) => expect(star(p.id).listenerCount()).toBe(0));
  });
});
