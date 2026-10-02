import { A_NOW } from "@/lib/sky/constants";
import type { PlayerStore } from "@/lib/sky/player-store";
import { arcPlace, entryLook, railAngles, reelGeo, reelWidth, toldStrength, type ReelGeo } from "@/lib/sky/reel-geometry";
import type { ReelEntry } from "@/lib/sky/reel-model";
import type { Frame } from "@/lib/sky/scene-model";
import { entryYs, tapeYs } from "@/lib/sky/tape";
import { typed, typedKey, typedMarkup, type Typed } from "@/lib/sky/typewriter";

export interface ReelInit {
  /** The stage that holds the sky disc, the reel and the rail. */
  readonly area: HTMLElement;
  readonly ol: HTMLOListElement;
  readonly rail: SVGSVGElement;
  readonly entries: readonly ReelEntry[];
  readonly store: PlayerStore;
  /** Jumps the clock to a year (pausing it). */
  seek(t: number): void;
  /** Set once the life is saved: linked names in prose then open the person sheet. */
  openPerson?: (personId: string) => void;
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

const CARET = '<span class="sky-caret"></span>';
const WIDE = "(min-width: 1000px)";
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
export function createReel({ area, ol, rail, entries, store, seek, openPerson }: ReelInit) {
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

  const layout = () => {
    wide = matchMedia(WIDE).matches;
    const a = area.getBoundingClientRect();
    geo = reelGeo(a, disc.getBoundingClientRect());
    rail.setAttribute("viewBox", `0 0 ${a.width} ${a.height}`);
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

  const draw = (frame: Frame) => {
    last = frame;
    const t = frame.t;
    const ys = entryYs(ats, tape, t);
    let toldIdx = -1;
    ats.forEach((at, i) => {
      if (at <= t) toldIdx = i;
    });
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
      const focus = strength > 0.5;
      toggle(row.li, "focus", focus);
      // The rules above and below arrive only once the entry is fully written.
      toggle(row.li, "ruled", focus && state.done);
      if (row.bead) {
        toggle(row.bead, "on", !future);
        toggle(row.bead, "lit", focus);
      }
    }
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
    destroy() {
      offFrame();
      observer.disconnect();
      ol.removeEventListener("click", onClick);
      ol.removeEventListener("keydown", onKey);
    },
  };
}

export { NS };
