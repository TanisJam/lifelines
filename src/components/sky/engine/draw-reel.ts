import { A_NOW, R_COMPASS, R_PROGRESS } from "@/lib/sky/constants";
import { dialAngle, type Timeline } from "@/lib/sky/dial";
import { paramAt, polar, quad, travel } from "@/lib/sky/motion";
import { prefersReducedMotion, subscribeReducedMotion } from "@/lib/sky/motion-pref";
import type { PlayerStore } from "@/lib/sky/player-store";
import { arcPlace, entryLook, inReelZone, leaderCurve, railAngles, reelGeo, reelWidth, toPx, toldStrength, type ReelGeo } from "@/lib/sky/reel-geometry";
import type { ReelEntry } from "@/lib/sky/reel-model";
import type { Frame } from "@/lib/sky/scene-model";
import { entryYs, scrollAt, tapeYs } from "@/lib/sky/tape";
import { typed, typedKey, typedMarkup, type Typed } from "@/lib/sky/typewriter";

export interface ReelInit {
  /** The stage that holds the sky disc, the reel and the rail. */
  readonly area: HTMLElement;
  readonly ol: HTMLOListElement;
  readonly rail: SVGSVGElement;
  readonly entries: readonly ReelEntry[];
  readonly store: PlayerStore;
  readonly timeline: Timeline;
  /** Hover focus on the sky: lights the people of an entry, rings the ones it names. */
  readonly focus: { setEntry(ids: readonly string[] | null): void; setNamed(ids: ReadonlySet<string>): void };
  /** Jumps the clock to a year (pausing it). */
  seek(t: number): void;
  /** Set once the life is saved: linked names in prose then open the person sheet. */
  openPerson?: (personId: string) => void;
  /** The tape's position under the present just moved by this many pixels (entries were added or replaced): ease it away instead of jumping. */
  tapeOffset?: number;
}

interface Row {
  readonly li: HTMLElement;
  readonly node: HTMLElement;
  readonly body: HTMLElement;
  /** Title, optional decider, prose: in typing order. */
  readonly texts: readonly HTMLElement[];
  readonly bead: Element | null;
  key: string;
}

interface Leader {
  readonly path: SVGPathElement;
  readonly spark: SVGCircleElement;
  readonly phase: number;
  used: boolean;
}

const CARET = '<span class="sky-caret"></span>';
const WIDE = "(min-width: 1000px)";
/** Years the clock moves per wheel pixel (scrolling down goes deeper into the past). */
const WHEEL_YEARS = 0.004;
/** How long a reconcile's tape shift takes to settle. */
const GLIDE_MS = 600;
const NS = "http://www.w3.org/2000/svg";
const show = (el: HTMLElement, on: boolean) => {
  const want = on ? "" : "none";
  if (el.style.display !== want) el.style.display = want;
};
const toggle = (el: Element, name: string, on: boolean) => {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
};

/**
 * The chronicle reel: entries hang on a great arc and flow past the present as the clock moves. Each
 * entry's place, opacity and typed text are pure functions of the sim clock (`entryYs`, `entryLook`,
 * `typed`), so pausing and scrubbing carry the reel with them. Driven by player-store frames; React
 * renders the rows once and never sees a frame.
 */
export function createReel({ area, ol, rail, entries, store, timeline: line, focus, seek, openPerson, tapeOffset = 0 }: ReelInit) {
  const disc = area.querySelector<HTMLElement>(".sky-disc")!;
  const ats = entries.map((e) => e.at);
  const tape = tapeYs(ats);
  const rows: Row[] = entries.map((e, i) => {
    const li = ol.children[i] as HTMLElement;
    const q = (sel: string) => li.querySelector<HTMLElement>(sel);
    return {
      li,
      node: q(".node")!,
      body: q(".body")!,
      texts: [q(".t")!, ...(e.text.by === undefined ? [] : [q(".by")!]), q(".p")!],
      bead: area.querySelector(`[data-bead="${CSS.escape(e.id)}"]`),
      key: "",
    };
  });

  let geo: ReelGeo = reelGeo({ left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0, width: 0, height: 0 });
  let wide = true;
  let last: Frame | null = null;
  let hovered = -1;
  let reduced = prefersReducedMotion();
  const offReduced = subscribeReducedMotion((r) => (reduced = r));
  const leaders = new Map<string, Leader>();
  const leaderLayer = rail.querySelector("[data-rail-leaders]")!;
  const beadPx = entries.map((e) => polar(dialAngle(e.at, line.dialStart, line.dialSpan), R_PROGRESS));

  /** A dotted thread from an entry to a star or its bead, with a spark that keeps crossing it at one speed. */
  const drawLeader = (key: string, from: readonly [number, number], to: readonly [number, number], strength: number, now: number, bow?: number) => {
    let l = leaders.get(key);
    if (!l) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("class", "sky-leader");
      const spark = document.createElementNS(NS, "circle");
      spark.setAttribute("class", "sky-leader-spark");
      spark.setAttribute("r", "1.8");
      leaderLayer.append(path, spark);
      l = { path, spark, phase: Math.random(), used: true };
      leaders.set(key, l);
    }
    l.used = true;
    const { d, c } = leaderCurve(from, to, bow);
    l.path.setAttribute("d", d);
    l.path.style.opacity = (0.55 * strength).toFixed(3);
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    const k = reduced ? 0.5 : (now * (90 / len) + l.phase) % 1;
    const [sx, sy] = quad(from, c, to, paramAt(from, c, to, k));
    l.spark.setAttribute("cx", sx.toFixed(1));
    l.spark.setAttribute("cy", sy.toFixed(1));
    l.spark.style.opacity = reduced ? "0" : (strength * Math.sin(Math.PI * k)).toFixed(3);
  };
  const clearLeaders = () => {
    leaders.clear();
    leaderLayer.replaceChildren();
  };

  const layout = () => {
    wide = matchMedia(WIDE).matches;
    const a = area.getBoundingClientRect();
    geo = reelGeo(a, disc.getBoundingClientRect());
    rail.setAttribute("viewBox", `0 0 ${a.width} ${a.height}`);
    clearLeaders();
    const arc = rail.querySelector("[data-rail-arc]")!;
    const nowTick = rail.querySelector("[data-rail-now]")!;
    if (!wide) {
      arc.setAttribute("d", "");
      nowTick.setAttribute("x1", "0");
      nowTick.setAttribute("x2", "0");
      return;
    }
    const at = (deg: number) => [geo.cx + geo.ra * Math.cos((deg * Math.PI) / 180), geo.cy + geo.ra * Math.sin((deg * Math.PI) / 180)] as const;
    const { from, to } = railAngles(geo);
    const [x0, y0] = at(from);
    const [x1, y1] = at(to);
    const grad = rail.querySelector("linearGradient")!;
    grad.setAttribute("y1", String(y0));
    grad.setAttribute("y2", String(y1));
    arc.setAttribute("d", `M${x0},${y0} A${geo.ra},${geo.ra} 0 0 1 ${x1},${y1}`);
    // The present: a small gold tick across the arc where entries are inked in.
    const [nx, ny] = at(A_NOW);
    const na = (A_NOW * Math.PI) / 180;
    nowTick.setAttribute("x1", String(nx - Math.cos(na) * 9));
    nowTick.setAttribute("y1", String(ny - Math.sin(na) * 9));
    nowTick.setAttribute("x2", String(nx + Math.cos(na) * 9));
    nowTick.setAttribute("y2", String(ny + Math.sin(na) * 9));
  };

  const write = (i: number, state: Typed) => {
    const row = rows[i]!;
    const entry = entries[i]!;
    const prose = row.texts.length - 1;
    row.texts.forEach((el, j) => {
      const n = state.counts[j]!;
      const text = entry.parts[j]!.text;
      el.innerHTML = (j === prose ? typedMarkup(text, entry.text.links, n) : typedMarkup(text, [], n)) + (state.caret === j ? CARET : "");
      show(el, n > 0 || state.caret === j);
    });
  };

  const glideFrom = performance.now();
  let shift = 0;
  const draw = (frame: Frame) => {
    last = frame;
    const t = frame.t;
    // The tape shifted under the present: ease that shift out over GLIDE_MS (travel's brake, no overshoot).
    shift = tapeOffset * (1 - travel(Math.min(1, (performance.now() - glideFrom) / GLIDE_MS)));
    const ys = shift === 0 ? entryYs(ats, tape, t) : entryYs(ats, tape, t).map((y) => y - shift);
    let toldIdx = -1;
    ats.forEach((at, i) => {
      if (at <= t) toldIdx = i;
    });
    const now = performance.now() / 1000;
    const people = new Map(frame.people.map((p) => [p.id, p]));
    const named = new Set<string>();
    leaders.forEach((l) => (l.used = false));
    let order = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const row = rows[i]!;
      const entry = entries[i]!;
      const y = ys[i]!;
      const future = entry.at > t;
      const look = entryLook(y, future);
      const hide = () => {
        show(row.li, false);
        if (row.bead) toggle(row.bead, "on", !future);
      };
      if (look.opacity < 0.01) {
        hide();
        continue;
      }
      if (wide) {
        const place = arcPlace(geo, y);
        if (!place) {
          hide();
          continue;
        }
        row.li.style.transform = `translate(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px)`;
        row.li.style.setProperty("--w", `${reelWidth(geo, place.x).toFixed(0)}px`);
      } else {
        if (future) {
          show(row.li, false);
          continue;
        }
        row.li.style.order = String(order++);
      }
      show(row.li, true);
      row.li.style.opacity = look.opacity.toFixed(3);
      row.node.style.opacity = String(look.node);
      row.body.style.opacity = future ? "0" : "1";
      const state = typed(entry.parts, t - entry.at);
      const key = typedKey(state);
      if (key !== row.key) {
        row.key = key;
        write(i, state);
      }
      const strength = i === toldIdx ? toldStrength(y, t, entry.at) : 0;
      const focused = strength > 0.5 || hovered === i;
      toggle(row.li, "focus", focused);
      // The rules above and below arrive only once the entry is fully written.
      toggle(row.li, "ruled", focused && state.done);
      if (row.bead) {
        toggle(row.bead, "on", !future);
        toggle(row.bead, "lit", focused);
      }
      // Threads run from the entry to its moment on the ring and to each person it touches, while it is told or hovered.
      const pull = Math.max(strength, hovered === i ? 1 : 0);
      if (wide && pull > 0.02) {
        const from = arcPlace(geo, y);
        if (from) {
          const origin = [from.x, from.y] as const;
          drawLeader(`${entry.id}-time`, origin, toPx(geo, beadPx[i]!), pull * 0.8, now, -0.12);
          for (const id of entry.who) {
            const p = people.get(id);
            if (!p || p.presence < 1) continue;
            drawLeader(`${entry.id}-${id}`, origin, toPx(geo, p.pos), pull, now);
            if (pull > 0.5) named.add(id);
          }
        }
      }
    }
    leaders.forEach((l) => {
      if (!l.used) {
        l.path.style.opacity = "0";
        l.spark.style.opacity = "0";
      }
    });
    focus.setNamed(named);
  };

  const activate = (ev: Event): HTMLElement | null => (ev.target as Element).closest<HTMLElement>("li");
  const onClick = (ev: MouseEvent) => {
    const link = (ev.target as Element).closest<HTMLElement>("a[data-person-link]");
    if (link) {
      ev.preventDefault();
      if (openPerson) openPerson(link.dataset.personLink!);
      return;
    }
    const li = activate(ev);
    const i = li ? rows.findIndex((r) => r.li === li) : -1;
    if (i >= 0) seek(entries[i]!.at + 0.03);
  };
  const onKey = (ev: KeyboardEvent) => {
    if ((ev.key !== "Enter" && ev.key !== " ") || (ev.target as Element).closest("a")) return;
    const i = rows.findIndex((r) => r.li === ev.target);
    if (i < 0) return;
    ev.preventDefault();
    seek(entries[i]!.at + 0.03);
  };
  const hover = (i: number) => {
    hovered = i;
    focus.setEntry(i >= 0 ? entries[i]!.who : null);
    if (last) draw(last);
  };
  const hoverHandlers = rows.map((row, i) => {
    const enter = () => hover(i);
    const leave = () => hovered === i && hover(-1);
    row.li.addEventListener("mouseenter", enter);
    row.li.addEventListener("mouseleave", leave);
    row.li.addEventListener("focus", enter);
    row.li.addEventListener("blur", leave);
    return { enter, leave };
  });
  /** Scrolling anywhere over the reel zone (right of the compass, the gaps between rows included) moves through time. */
  const onWheel = (ev: WheelEvent) => {
    if (!wide || !last) return;
    const a = area.getBoundingClientRect();
    if (!inReelZone(ev.clientX, ev.clientY, { x: a.left + geo.cx, y: a.top + geo.cy }, (R_COMPASS + 30) * geo.unit, a)) return;
    ev.preventDefault();
    seek(last.t - ev.deltaY * (ev.deltaMode === 1 ? 33 : 1) * WHEEL_YEARS);
  };
  area.addEventListener("wheel", onWheel, { passive: false });
  ol.addEventListener("click", onClick);
  ol.addEventListener("keydown", onKey);

  const observer = new ResizeObserver(() => {
    layout();
    if (last) draw(last);
  });
  observer.observe(area);
  layout();
  const offFrame = store.onFrame(draw);

  return {
    /** Where the clock was and which tape position was under the present on the last frame: what a successor reel eases from. */
    snapshot(): { t: number; scroll: number } | null {
      return last ? { t: last.t, scroll: scrollAt(ats, tape, last.t) - shift } : null;
    },
    destroy() {
      offFrame();
      observer.disconnect();
      ol.removeEventListener("click", onClick);
      ol.removeEventListener("keydown", onKey);
      area.removeEventListener("wheel", onWheel);
      rows.forEach((row, i) => {
        row.li.removeEventListener("mouseenter", hoverHandlers[i]!.enter);
        row.li.removeEventListener("mouseleave", hoverHandlers[i]!.leave);
        row.li.removeEventListener("focus", hoverHandlers[i]!.enter);
        row.li.removeEventListener("blur", hoverHandlers[i]!.leave);
      });
      offReduced();
      clearLeaders();
    },
  };
}

export { NS };
