import type { EdgeKind } from "@/contracts/life";
import { KIND_PULSE, SPARK } from "@/lib/sky/constants";
import { control, paramAt, quad, type Side, type Vec } from "@/lib/sky/motion";

/**
 * Real-time ambient layers: stars drifting on tiny orbits and sparks travelling along living bonds.
 * They read wall-clock time on purpose, so they are outside the scrub-determinism guarantee and are
 * switched off entirely under prefers-reduced-motion.
 */

/** Slow drift of a star around its resting place; the protagonist barely moves. */
export function floatOffset(index: number, isSelf: boolean, now: number): Vec {
  const orbit = (0.176 + (index % 5) * 0.024) * (index % 2 ? 1 : -1);
  const phase = index * 1.7;
  const amp = isSelf ? 1.4 : 3;
  return [Math.cos(now * orbit + phase) * amp, Math.sin(now * orbit + phase) * amp];
}

/** What the engine knows about a drawn bond this frame. */
export interface LiveBond {
  readonly kind: EdgeKind;
  readonly a: Vec;
  readonly b: Vec;
  readonly side: Side;
  /** Fully drawn and both ends alive: sparks may travel. */
  readonly living: boolean;
}

interface Spark {
  readonly key: string;
  readonly el: SVGCircleElement;
  readonly born: number;
  readonly life: number;
  readonly reverse: boolean;
}

export function createAmbient(layer: SVGGElement) {
  const sparks: Spark[] = [];
  const nextAt = new Map<string, number>();
  const NS = "http://www.w3.org/2000/svg";

  const emit = (key: string, kind: EdgeKind, now: number) => {
    const el = document.createElementNS(NS, "circle");
    const tint = SPARK[kind];
    el.setAttribute("r", String(kind === "spouse" ? 2.3 : kind === "parent" ? 1.6 : 1.9));
    el.setAttribute("fill", tint);
    el.style.filter = `drop-shadow(0 0 2.5px ${tint}) drop-shadow(0 0 6px ${tint})`;
    layer.appendChild(el);
    sparks.push({ key, el, born: now, life: KIND_PULSE[kind][1] * (0.85 + Math.random() * 0.3), reverse: Math.random() < 0.5 });
  };

  const clear = () => {
    sparks.splice(0).forEach((s) => s.el.remove());
    nextAt.clear();
  };

  return {
    clear,
    /** Schedules and moves sparks for this frame. `bonds` holds only bonds that are drawn right now. */
    tick(now: number, bonds: ReadonlyMap<string, LiveBond>): void {
      for (const [key, bond] of bonds) {
        if (!bond.living) {
          nextAt.delete(key);
          continue;
        }
        const due = nextAt.get(key);
        if (due === undefined || now >= due) {
          if (due !== undefined) emit(key, bond.kind, now);
          nextAt.set(key, now + -Math.log(1 - Math.random()) / KIND_PULSE[bond.kind][0]);
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        const bond = bonds.get(s.key);
        const k = (now - s.born) / s.life;
        if (k >= 1 || !bond) {
          s.el.remove();
          sparks.splice(i, 1);
          continue;
        }
        const c = control(bond.a, bond.b, 0.16, bond.side);
        const [x, y] = quad(bond.a, c, bond.b, paramAt(bond.a, c, bond.b, s.reverse ? 1 - k : k));
        s.el.setAttribute("cx", x.toFixed(1));
        s.el.setAttribute("cy", y.toFixed(1));
        s.el.style.opacity = (Math.sin(Math.PI * k) * 0.95).toFixed(3);
      }
    },
  };
}
