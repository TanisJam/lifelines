import type { Ref } from "react";
import type { LifeScene, ScenePerson } from "@/contracts/life";
import { R2, R_COMPASS, R_DIAL, R_PROGRESS, SPARK } from "@/lib/sky/constants";
import { arcPath, dialAngle, type Timeline } from "@/lib/sky/dial";
import { edgeKey } from "@/lib/sky/layout";
import { polar } from "@/lib/sky/motion";
import { villagePos } from "@/lib/sky/village";

/** A distant sky for depth: fixed, keyed, never part of the story. */
const DISTANT = Array.from({ length: 240 }, (_, i) => ({ i, ...villagePos(`distant:${i}`) }));
const COMPASS_LABELS = [["N", -90], ["E", 0], ["S", 90], ["W", 180]] as const;
const f1 = (n: number) => n.toFixed(1);

/** `starPath(34, 0.8, 4)` of the mock: the faint four-point flare behind the protagonist. */
const FLARE = Array.from({ length: 8 }, (_, i) => {
  const r = i % 2 ? 0.8 : 34;
  const a = (i * Math.PI) / 4 - Math.PI / 2;
  return `${i ? "L" : "M"}${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
}).join("") + "Z";

/**
 * The constellation's nodes, rendered once. Every moving attribute (transform, path data, opacity, state
 * classes) is written by the engine through the `data-*` hooks below, so React never re-renders a frame.
 */
export function SkySvg({ scene, timeline: line, label, svgRef, relation, bandLabels }: { scene: LifeScene; timeline: Timeline; label: string; svgRef: Ref<SVGSVGElement>; relation: (person: ScenePerson) => string; bandLabels: Record<string, string> }) {
  const years = Array.from({ length: line.dialSpan }, (_, k) => line.dialStart + k);
  return (
    <svg ref={svgRef} className="sky-svg" viewBox="-400 -400 800 800" role="img" aria-label={label}>
      <defs>
        {[["bloom", 4.5], ["bloom-sm", 2]].map(([id, sd]) => (
          <filter key={id} id={`sky-${id}`} x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation={sd} />
          </filter>
        ))}
      </defs>
      <g>
        {DISTANT.map((s) => (
          <circle key={s.i} className={`sky-bgstar far${s.twinkle ? " tw" : ""}`} cx={f1(s.x)} cy={f1(s.y)} r={(s.size * 0.5).toFixed(2)} style={{ opacity: s.base * 0.6, animationDelay: `${s.delay}s` }} />
        ))}
      </g>
      <g>
        {scene.village.map((v, i) => {
          const s = villagePos(v.k);
          return <circle key={v.k} data-village={i} className={`sky-bgstar${s.twinkle ? " tw" : ""} gone`} cx={f1(s.x)} cy={f1(s.y)} r={s.size.toFixed(2)} style={{ opacity: s.base, animationDelay: `${s.delay}s` }} />;
        })}
      </g>
      <circle data-wash className="sky-wash" r={R_DIAL - 4} />
      <g>
        <circle className="sky-ring faint" r={R2 + 4} />
        <line className="sky-cross" x1={0} y1={-R_COMPASS} x2={0} y2={R_COMPASS} />
        <line className="sky-cross" x1={-R_COMPASS} y1={0} x2={R_COMPASS} y2={0} />
        <circle className="sky-ring" r={R_DIAL} />
        {years.map((y) => {
          const major = y % 10 === 0 || y === line.dialStart;
          const angle = dialAngle(y, line.dialStart, line.dialSpan);
          const [x1, y1] = polar(angle, R_DIAL);
          const [x2, y2] = polar(angle, R_DIAL - (major ? 9 : 4));
          const [lx, ly] = polar(angle, R_DIAL - 24);
          return (
            <g key={y}>
              <line className={`sky-tick${major ? " major" : ""}`} x1={f1(x1)} y1={f1(y1)} x2={f1(x2)} y2={f1(y2)} />
              {major && (
                <text className="sky-dial-label" x={f1(lx)} y={f1(ly)}>
                  {y}
                </text>
              )}
            </g>
          );
        })}
        {scene.bands.map((b) => {
          const [lx, ly] = polar(dialAngle((b.from + b.to) / 2, line.dialStart, line.dialSpan), R_DIAL + 13);
          return (
            <g key={b.kind}>
              <path data-band={b.kind} data-from={b.from} data-to={b.to} className="sky-plague" d={arcPath(R_DIAL, dialAngle(b.from, line.dialStart, line.dialSpan), dialAngle(b.to, line.dialStart, line.dialSpan))} />
              <text className="sky-plague-label" x={f1(lx)} y={f1(ly)}>
                {bandLabels[b.kind]}
              </text>
            </g>
          );
        })}
        <circle className="sky-ring faint" r={R_PROGRESS} />
        <path data-progress-glow className="sky-progress glow" />
        <path data-progress className="sky-progress" />
        <circle className="sky-ring compass" r={R_COMPASS} />
        {Array.from({ length: 72 }, (_, k) => {
          const a = k * 5;
          const major = a % 45 === 0;
          const [x1, y1] = polar(a, R_COMPASS);
          const [x2, y2] = polar(a, R_COMPASS + (major ? 8 : 3.5));
          return <line key={a} className={`sky-tick${major ? " major" : ""}`} x1={f1(x1)} y1={f1(y1)} x2={f1(x2)} y2={f1(y2)} />;
        })}
        {COMPASS_LABELS.map(([l, a]) => {
          const [x, y] = polar(a, R_COMPASS + 22);
          return (
            <text key={l} className="sky-compass-label" x={f1(x)} y={f1(y)}>
              {l}
            </text>
          );
        })}
        <g data-marker>
          <circle className="sky-marker-glow" r={9} />
          <circle className="sky-marker-ring" r={8.5} />
          <circle className="sky-marker-dot" r={3.2} />
        </g>
      </g>
      <g>
        {scene.people.map((p) => (
          <path key={p.id} data-trail={p.id} className="sky-trail" style={{ opacity: 0 }} />
        ))}
      </g>
      <g>
        {scene.edges.map((e) => {
          const key = edgeKey(e);
          return (
            <g key={key}>
              <path data-edge={key} className={`sky-edge ${e.kind}`} style={{ display: "none" }} />
              <circle data-head={key} className="sky-head" r={2.4} fill={SPARK[e.kind]} style={{ opacity: 0 }} />
            </g>
          );
        })}
      </g>
      <g data-sparks className="sky-sparks" />
      <g>
        {scene.people.map((p) => {
          const self = p.group === "self";
          return (
            <g key={p.id} data-person={p.id} className={`sky-node${self ? " self" : ""}`} role="button" tabIndex={0} aria-label={`${p.name}, ${relation(p)}`} style={{ display: "none" }}>
              <circle className="sky-halo" r={self ? 18 : p.group === "outer" ? 7 : 9} />
              <circle className="sky-ping" r={self ? 15 : 10} />
              {self && (
                <g className="sky-spin">
                  <path className="sky-flare" d={FLARE} />
                </g>
              )}
              <circle className="sky-core" r={self ? 8 : p.group === "outer" ? 3.4 : 4.4} />
              <text className="sky-nm" y={self ? 30 : 19}>
                {p.name}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

