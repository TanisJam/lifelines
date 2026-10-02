import type { LifeScene, SceneEdge } from "@/contracts/life";
import { R_PROGRESS } from "@/lib/sky/constants";
import { arcPath, dialAngle, type Timeline } from "@/lib/sky/dial";
import { control, paramAt, partial, polar, quad, travel, type Vec } from "@/lib/sky/motion";
import { prefersReducedMotion, subscribeReducedMotion } from "@/lib/sky/motion-pref";
import { nextSpeed, type PlayerStore } from "@/lib/sky/player-store";
import { computeLayout, edgeKey } from "@/lib/sky/layout";
import { scrubTo, stepClock } from "@/lib/sky/clock";
import { frameAt } from "@/lib/sky/scene-model";
import { createAmbient, floatOffset, type LiveBond } from "./ambient";

export interface SkyEngineInit {
  readonly svg: SVGSVGElement;
  readonly scene: LifeScene;
  readonly timeline: Timeline;
  readonly store: PlayerStore;
  /** How far the clock may run; defaults to the end of the timeline (a saved life). */
  readonly frontier?: number;
}

/** What changes while a life is being written. */
export interface SkyUpdate {
  readonly scene: LifeScene;
  readonly timeline: Timeline;
  readonly frontier?: number;
}

export interface SkyEngine {
  toggle(): void;
  pause(): void;
  cycleSpeed(): void;
  /** Jumps to a year (paused). Clamped to the life. */
  seek(t: number): void;
  /**
   * A grown scene (a new tick, or done) over the same sky: nodes are re-bound and the layout recomputed, but the
   * clock and every star already placed stay where they are. Call after React has rendered the new nodes.
   */
  update(next: SkyUpdate): void;
  destroy(): void;
}

const one = <T extends Element>(root: ParentNode, selector: string): T => root.querySelector<T>(selector)!;
const setClass = (el: Element, name: string, on: boolean) => {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
};

/**
 * One rAF loop that owns the clock and writes the sky's SVG attributes directly: React renders the nodes
 * once (see SkySvg) and never sees a frame. Everything scene-derived comes from the pure `frameAt(t)`; only
 * the ambient layer (drift, sparks) reads wall-clock time.
 */
export function createSkyEngine({ svg, scene: initialScene, timeline: initialLine, store, frontier: initialFrontier }: SkyEngineInit): SkyEngine {
  let scene = initialScene;
  let line = initialLine;
  let layout = computeLayout(scene);
  let bounds = { start: line.start, frontier: initialFrontier ?? line.end, end: line.end };
  let personEls = new Map<string, { g: SVGGElement; core: SVGElement; trail: SVGPathElement }>();
  let edgeEls = new Map<string, { path: SVGPathElement; head: SVGCircleElement }>();
  let edgeByKey = new Map<string, SceneEdge>();
  let villageEls: SVGElement[] = [];
  let bandEls: SVGElement[] = [];
  let selfId: string | undefined;
  /** Finds the nodes SkySvg rendered for the current scene. */
  const bind = () => {
    personEls = new Map();
    scene.people.forEach((p) => {
      const g = one<SVGGElement>(svg, `[data-person="${CSS.escape(p.id)}"]`);
      personEls.set(p.id, { g, core: one(g, ".sky-core"), trail: one(svg, `[data-trail="${CSS.escape(p.id)}"]`) });
    });
    edgeEls = new Map();
    scene.edges.forEach((e) => {
      const key = edgeKey(e);
      edgeEls.set(key, { path: one(svg, `[data-edge="${CSS.escape(key)}"]`), head: one(svg, `[data-head="${CSS.escape(key)}"]`) });
    });
    edgeByKey = new Map(scene.edges.map((e) => [edgeKey(e), e]));
    villageEls = [...svg.querySelectorAll<SVGElement>("[data-village]")];
    bandEls = [...svg.querySelectorAll<SVGElement>("[data-band]")];
    selfId = scene.people.find((p) => p.group === "self")?.id;
  };
  bind();
  const progress = one<SVGPathElement>(svg, "[data-progress]");
  const glow = one<SVGPathElement>(svg, "[data-progress-glow]");
  const marker = one<SVGGElement>(svg, "[data-marker]");
  const wash = one<SVGElement>(svg, "[data-wash]");
  const ambient = createAmbient(one<SVGGElement>(svg, "[data-sparks]"));

  let t = line.start;
  let reduced = prefersReducedMotion();
  let villageStep = -1;
  let last = performance.now();
  let raf = 0;
  const offReduced = subscribeReducedMotion((r) => {
    reduced = r;
    if (r) ambient.clear();
  });

  const render = (now: number) => {
    const f = frameAt(scene, layout, t);
    const people = new Map(f.people.map((p) => [p.id, p]));
    const cur = new Map<string, Vec>();
    const shown = new Set<string>();
    scene.people.forEach((p, i) => {
      const pf = people.get(p.id);
      const els = personEls.get(p.id)!;
      if (!pf) return;
      shown.add(p.id);
      const drift = reduced ? ([0, 0] as const) : floatOffset(i, p.id === selfId, now);
      const pos: Vec = [pf.pos[0] + drift[0], pf.pos[1] + drift[1]];
      cur.set(p.id, pos);
      const arriving = pf.presence < 1;
      const s = arriving ? 0.35 + 0.65 * travel(pf.presence) : 1;
      els.g.style.display = "";
      els.g.setAttribute("transform", `translate(${pos[0].toFixed(1)},${pos[1].toFixed(1)})${arriving ? ` scale(${s.toFixed(3)})` : ""}`);
      els.g.setAttribute("opacity", arriving ? Math.min(1, pf.presence * 2.5).toFixed(3) : "1");
      els.core.style.opacity = pf.coreOpacity.toFixed(3);
      setClass(els.g, "circle", pf.inCircle);
      setClass(els.g, "outside", !pf.inCircle);
      setClass(els.g, "dead", !pf.alive);
      const origin = layout.origins.get(p.id);
      const home = layout.homes.get(p.id);
      if (arriving && origin && home) {
        const c = control(origin, home, 0.22, layout.arriveSides.get(p.id)!);
        els.trail.setAttribute("d", partial(origin, c, home, paramAt(origin, c, home, travel(pf.presence))));
        els.trail.style.opacity = String(0.5 * Math.min(1, pf.presence * 4) * (1 - pf.presence));
      } else els.trail.style.opacity = "0";
    });
    personEls.forEach((els, id) => {
      if (!shown.has(id)) els.g.style.display = "none";
    });

    const bonds = new Map<string, LiveBond>();
    const drawn = new Set<string>();
    for (const ef of f.edges) {
      const e = edgeByKey.get(ef.key)!;
      const a = cur.get(e.a);
      const b = cur.get(e.b);
      if (!a || !b) continue;
      drawn.add(ef.key);
      const els = edgeEls.get(ef.key)!;
      const side = layout.edgeSides.get(ef.key) ?? 1;
      const c = control(a, b, 0.16, side);
      const gp = paramAt(a, c, b, ef.growth);
      els.path.style.display = "";
      els.path.setAttribute("d", partial(a, c, b, ef.growth >= 1 ? 1 : gp));
      els.path.setAttribute("stroke-opacity", ef.opacity.toFixed(3));
      setClass(els.path, "former", ef.former);
      if (ef.growth < 1) {
        const [hx, hy] = quad(a, c, b, gp);
        els.head.setAttribute("cx", hx.toFixed(1));
        els.head.setAttribute("cy", hy.toFixed(1));
        els.head.style.opacity = String(Math.sin(Math.PI * ef.growth));
      } else els.head.style.opacity = "0";
      bonds.set(ef.key, { kind: e.kind, a, b, side, living: ef.growth >= 1 && ef.active && !!people.get(e.a)?.alive && !!people.get(e.b)?.alive });
    }
    edgeEls.forEach((els, key) => {
      if (drawn.has(key)) return;
      els.path.style.display = "none";
      els.head.style.opacity = "0";
    });
    if (reduced) ambient.clear();
    else ambient.tick(now, bonds);

    const step = Math.floor(t * 48);
    if (step !== villageStep) {
      villageStep = step;
      scene.village.forEach((v, i) => setClass(villageEls[i]!, "gone", !(v.b <= t && (v.d === undefined || v.d > t))));
    }
    wash.style.opacity = (0.08 * f.plague).toFixed(3);
    bandEls.forEach((el) => {
      const inside = t > Number(el.dataset.from) && t < Number(el.dataset.to);
      el.style.opacity = String(inside ? 0.5 + 0.5 * f.plague : 0.5);
    });
    const a0 = dialAngle(line.start, line.dialStart, line.dialSpan);
    const a1 = dialAngle(t, line.dialStart, line.dialSpan);
    progress.setAttribute("d", arcPath(R_PROGRESS, a0, a1));
    glow.setAttribute("d", arcPath(R_PROGRESS, a0, a1));
    const [mx, my] = polar(a1, R_PROGRESS);
    marker.setAttribute("transform", `translate(${mx.toFixed(1)},${my.toFixed(1)})`);
    store.emitFrame(f);
  };

  const loop = (ms: number) => {
    const dt = (ms - last) / 1000;
    last = ms;
    const state = store.get();
    if (state.playing) {
      const c = stepClock({ t, playing: true, speed: state.speed, frontier: bounds.frontier, end: bounds.end }, dt);
      t = c.t;
      store.set({ playing: c.playing, waiting: c.waiting });
    }
    render(ms / 1000);
    raf = requestAnimationFrame(loop);
  };
  render(performance.now() / 1000);
  raf = requestAnimationFrame(loop);

  return {
    toggle() {
      if (store.get().playing) return store.set({ playing: false });
      if (t >= bounds.end) t = line.start;
      store.set({ playing: true });
    },
    pause: () => store.set({ playing: false }),
    cycleSpeed: () => store.set({ speed: nextSpeed(store.get().speed) }),
    seek(target) {
      store.set({ playing: false, waiting: false });
      t = scrubTo(target, bounds);
      ambient.clear();
      render(performance.now() / 1000);
    },
    update(next) {
      scene = next.scene;
      line = next.timeline;
      layout = computeLayout(scene);
      bounds = { start: line.start, frontier: next.frontier ?? line.end, end: line.end };
      t = Math.min(t, Math.min(bounds.frontier, bounds.end));
      bind();
      villageStep = -1;
      render(performance.now() / 1000);
    },
    destroy() {
      cancelAnimationFrame(raf);
      offReduced();
      ambient.clear();
    },
  };
}
