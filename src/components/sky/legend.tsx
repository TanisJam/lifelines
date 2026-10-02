import type { LifeSex } from "@/contracts/life";
import type { Dictionary } from "@/i18n/dictionary";

const Line = ({ stroke, width = 1.1, dash, cap }: { stroke: string; width?: number; dash?: string; cap?: "round" }) => (
  <svg viewBox="0 0 28 10" aria-hidden="true">
    <line x1="2" y1="5" x2="26" y2="5" stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinecap={cap} />
  </svg>
);

/** The five-line key to the sky, plus the closing line of the footer. */
export function Legend({ sky, village, sex }: { sky: Dictionary["sky"]; village: string; sex: LifeSex }) {
  const { legend } = sky;
  return (
    <>
      <div className="sky-legend" role="group" aria-label={legend.label}>
        <span>
          <svg viewBox="0 0 28 10" aria-hidden="true">
            <circle cx="14" cy="5" r="5" fill="#fff3d1" opacity="0.35" filter="url(#sky-bloom-sm)" />
            <circle cx="14" cy="5" r="2.6" fill="#fff3d1" />
          </svg>
          {legend.circle(sex)}
        </span>
        <span>
          <svg viewBox="0 0 28 10" aria-hidden="true">
            <circle cx="14" cy="5" r="1.5" fill="#f0d389" />
          </svg>
          {legend.others(village)}
        </span>
        <span>
          <Line stroke="rgb(240 212 150 / 0.8)" />
          {legend.bond}
        </span>
        <span>
          <Line stroke="rgb(232 205 146 / 0.7)" width={1} dash="3.5 3.5" />
          {legend.former}
        </span>
        <span>
          <Line stroke="rgb(232 205 146 / 0.8)" width={1.2} dash="1 3.2" cap="round" />
          {legend.conflict}
        </span>
      </div>
      <q className="sky-closing">{legend.closing}</q>
    </>
  );
}
