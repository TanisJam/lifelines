import type { LifeScene, ScenePerson } from "@/contracts/life";
import { focusSet } from "@/lib/sky/focus-set";
import { edgeKey } from "@/lib/sky/layout";
import type { PlayerStore } from "@/lib/sky/player-store";
import type { StarText } from "@/lib/sky/describe-star";
import type { Frame } from "@/lib/sky/scene-model";

export interface FocusInit {
  readonly svg: SVGSVGElement;
  /** The tooltip: holds `.r` (relation), `b` (name) and `.s` (details) children; lives inside the sky disc. */
  readonly tip: HTMLElement;
  readonly scene: LifeScene;
  readonly store: PlayerStore;
  describe(person: ScenePerson, t: number): StarText;
  /** A click on a star. Return true when it was handled (the sheet opened); false pins the star's focus and tooltip instead. */
  activate(personId: string): boolean;
}

export interface Focus {
  /** Entry focus: the people of the chronicle entry being hovered or told. Star focus wins while a star is hovered or pinned. */
  setEntry(ids: readonly string[] | null): void;
  /** Stars the told entry names, ringed with a ping. */
  setNamed(ids: ReadonlySet<string>): void;
  destroy(): void;
}

const TIP_WIDTH = 230;
const toggle = (el: Element, name: string, on: boolean) => {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
};

/**
 * Star and entry focus on the sky: dims what is not involved, lights the bonds, and shows the tooltip that
 * follows its star. Everything is imperative DOM work driven by hover, click and the player-store frames, so
 * React never renders a focus change.
 */
export function createFocus({ svg, tip, scene, store, describe, activate }: FocusInit): Focus {
  const people = new Map(scene.people.map((p) => [p.id, p]));
  const nodes = new Map<string, SVGGElement>();
  scene.people.forEach((p) => nodes.set(p.id, svg.querySelector<SVGGElement>(`[data-person="${CSS.escape(p.id)}"]`)!));
  const edges = new Map<string, SVGPathElement>();
  scene.edges.forEach((e) => edges.set(edgeKey(e), svg.querySelector<SVGPathElement>(`[data-edge="${CSS.escape(edgeKey(e))}"]`)!));
  const [relEl, nameEl, subEl] = [tip.querySelector(".r")!, tip.querySelector("b")!, tip.querySelector(".s")!];

  let frame: Frame | null = null;
  let hovered: string | null = null;
  let pinned: string | null = null;
  let entry: readonly string[] | null = null;
  let tipFor: string | null = null;

  const starId = () => hovered ?? pinned;
  const placeTip = () => {
    const id = tipFor;
    const pos = id && frame?.people.find((p) => p.id === id)?.pos;
    if (!pos) return;
    const rect = tip.parentElement!.getBoundingClientRect();
    const scale = rect.width / 800;
    const px = (pos[0] + 400) * scale;
    const py = (pos[1] + 400) * scale;
    tip.style.left = `${Math.min(Math.max(px - TIP_WIDTH / 2, 0), rect.width - TIP_WIDTH)}px`;
    tip.style.top = `${py > rect.height / 2 ? py - tip.offsetHeight - 22 : py + 26}px`;
  };

  const apply = () => {
    const star = starId();
    const t = frame?.t ?? scene.span.start;
    const ids = star ? [star] : entry && entry.length > 0 ? entry : null;
    const set = ids ? focusSet(scene, ids, t, star ? "star" : "entry") : null;
    toggle(svg, "focus", set !== null);
    nodes.forEach((el, id) => {
      toggle(el, "hl", !!set?.people.has(id));
      toggle(el, "focal", set?.focal === id);
    });
    edges.forEach((el, key) => toggle(el, "hl", !!set?.edges.has(key)));
    tipFor = star;
    tip.hidden = star === null;
    if (star) {
      const text = describe(people.get(star)!, t);
      relEl.textContent = text.rel;
      nameEl.textContent = text.name;
      subEl.textContent = text.sub;
      placeTip();
    }
  };

  const offFrame = store.onFrame((f) => {
    frame = f;
    if (tipFor) placeTip();
  });
  const cleanups: Array<() => void> = [];
  nodes.forEach((el, id) => {
    const enter = () => {
      hovered = id;
      apply();
    };
    const leave = () => {
      hovered = null;
      apply();
    };
    const click = () => {
      if (activate(id)) return;
      pinned = pinned === id ? null : id;
      apply();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      click();
    };
    el.addEventListener("mouseenter", enter);
    el.addEventListener("focus", enter);
    el.addEventListener("mouseleave", leave);
    el.addEventListener("blur", leave);
    el.addEventListener("click", click);
    el.addEventListener("keydown", key);
    cleanups.push(() => {
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("focus", enter);
      el.removeEventListener("mouseleave", leave);
      el.removeEventListener("blur", leave);
      el.removeEventListener("click", click);
      el.removeEventListener("keydown", key);
    });
  });
  const outside = (e: MouseEvent) => {
    if (pinned && !(e.target as Element).closest("[data-person]")) {
      pinned = null;
      apply();
    }
  };
  document.addEventListener("click", outside);

  return {
    setEntry(ids) {
      entry = ids;
      if (!starId()) apply();
    },
    setNamed(ids) {
      nodes.forEach((el, id) => toggle(el, "named", ids.has(id)));
    },
    destroy() {
      offFrame();
      document.removeEventListener("click", outside);
      cleanups.forEach((c) => c());
    },
  };
}
