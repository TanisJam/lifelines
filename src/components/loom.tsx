"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { streamSSE } from "@/lib/sse";
import type { DecisionRecord } from "@/domain/decisions";
import type { BranchDiff } from "@/domain/diff";
import type { LoomPerson } from "@/domain/loom-data";

const YEAR_WIDTH = 11;
const LANE_HEIGHT = 22;
const TOP_PADDING = 24;
const LEFT_PADDING = 8;
const LABEL_WIDTH = 168;

/** A score gap below this is shown as a "close call" (round 4 fix B1: fragility, not the old probability-gap margin). */
const FRAGILE_THRESHOLD = 0.5;

export interface LoomProps {
  worldId: string;
  branchId: string;
  branchLabel: string;
  townName: string;
  startYear: number;
  endYear: number;
  people: readonly LoomPerson[];
  laneOrder: readonly string[];
  decisions: readonly DecisionRecord[];
  branches: readonly { id: string; label: string; forkYear: number | null }[];
  ghost?: { branchId: string; label: string; people: readonly LoomPerson[]; laneOrder: readonly string[] } | null;
  diff?: BranchDiff | null;
}

function dotColor(kind: string): string {
  if (kind === "death" || kind === "illness" || kind === "A11") return "var(--color-crimson)";
  if (kind === "marriage" || kind === "Y1" || kind === "A2" || kind === "A1") return "var(--color-brass)";
  return "var(--color-muted-foreground)";
}

function laneColor(person: LoomPerson): string {
  if (person.deathYear !== null) return "var(--color-crimson)";
  return "var(--color-brass)";
}

function isFragile(d: DecisionRecord): boolean {
  return d.source !== "forced" && d.fragility < FRAGILE_THRESHOLD;
}

/** Whether a decision is worth a dot by default: something actually happened, or it was a fragile/surprising call — round 4 fix B2 (hide the dense trivial-yearly-roll clutter). */
function isNoteworthy(d: DecisionRecord): boolean {
  return d.resultingEventIds.length > 0 || d.source === "forced" || isFragile(d) || d.surprise;
}

/**
 * The Loom (decision 011): one lane per person across the town's timespan,
 * marriages joining lanes with a visible band, births branching a new lane
 * from the mother's, deaths ending a lane, immigrants entering from the
 * edge. Decision dots sit on a person's lane at the year they happened;
 * clicking one opens the inspector. Lane order is a family-grouped
 * heuristic with a marriage-adjacency pass (see `loom-data.ts`) — not full
 * StoryFlow crossing minimization.
 */
export function Loom(props: LoomProps): React.ReactElement {
  const router = useRouter();
  const { worldId, branchId, townName, startYear, endYear, people, laneOrder, decisions, branches, ghost, diff } = props;

  const [selected, setSelected] = useState<DecisionRecord | null>(null);
  const [forking, setForking] = useState<{ optionId: string; year: number; population: number } | null>(null);
  const [forkError, setForkError] = useState<string | null>(null);
  const [showAllRolls, setShowAllRolls] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const laneIndex = useMemo(() => new Map(laneOrder.map((id, i) => [id, i])), [laneOrder]);
  const ghostById = useMemo(() => new Map((ghost?.people ?? []).map((p) => [p.id, p])), [ghost]);
  const diffedPeopleIds = useMemo(() => new Set([...(diff?.diffs.map((d) => d.personId) ?? []), ...(diff?.newPeople.map((p) => p.personId) ?? []), ...(diff?.missingPeople.map((p) => p.personId) ?? [])]), [diff]);

  const x = (year: number) => LEFT_PADDING + (year - startYear) * YEAR_WIDTH;
  const laneY = (id: string) => TOP_PADDING + (laneIndex.get(id) ?? 0) * LANE_HEIGHT;

  const width = x(endYear) + 40;
  const height = TOP_PADDING + laneOrder.length * LANE_HEIGHT + 20;

  const visibleDecisionsByPerson = useMemo(() => {
    const map = new Map<string, DecisionRecord[]>();
    for (const d of decisions) {
      if (d.personId === "world") continue; // immigration: no lane to dot
      if (!showAllRolls && !isNoteworthy(d)) continue;
      if (!map.has(d.personId)) map.set(d.personId, []);
      map.get(d.personId)!.push(d);
    }
    return map;
  }, [decisions, showAllRolls]);

  const hoveredRelationships = useMemo(() => {
    if (!hoveredId) return [];
    const person = byId.get(hoveredId);
    if (!person) return [];
    return person.relationships.filter((r) => (r.bond === "friend" || r.bond === "grudge" || r.bond === "rival") && laneIndex.has(r.personId));
  }, [hoveredId, byId, laneIndex]);

  async function chooseInstead(optionId: string): Promise<void> {
    if (!selected) return;
    setForkError(null);
    setForking({ optionId, year: selected.year, population: 0 });
    try {
      let newBranchId: string | undefined;
      await streamSSE(`/api/worlds/${worldId}/edit/stream`, { branchId, override: { decisionId: selected.id, optionId } }, (event, data) => {
        if (event === "tick") {
          const d = data as { year: number; population: number };
          setForking({ optionId, year: d.year, population: d.population });
        } else if (event === "done") {
          newBranchId = (data as { branchId: string }).branchId;
        } else if (event === "error") {
          throw new Error((data as { message: string }).message);
        }
      });
      if (newBranchId) {
        router.push(`/world/${worldId}?branch=${newBranchId}&compare=${branchId}`);
      }
    } catch (err) {
      setForkError(err instanceof Error ? err.message : "The fork failed.");
    } finally {
      setForking(null);
    }
  }

  return (
    <div className="relative">
      {branches.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-4 py-3">
          <span className="font-label text-xs uppercase tracking-widest text-muted-foreground">Branches:</span>
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/world/${worldId}?branch=${b.id}`}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${b.id === branchId ? "border-brass bg-brass/10 text-brass" : "border-border text-muted-foreground hover:border-brass hover:text-brass"}`}
            >
              {b.label}
              {b.forkYear ? ` (${b.forkYear})` : ""}
            </Link>
          ))}
        </div>
      )}

      {diff && (
        <div className="mb-4 rounded-md border border-brass/40 bg-brass/5 p-3 text-sm">
          <p>
            Comparing against <strong>{ghost?.label}</strong>: {diff.changedPeopleCount} {diff.changedPeopleCount === 1 ? "person" : "people"} changed
            {diff.newPeople.length > 0 ? `, ${diff.newPeople.length} newly born` : ""}
            {diff.missingPeople.length > 0 ? `, ${diff.missingPeople.length} never born` : ""}. Diverged lanes are highlighted; the dashed lane is the original.
          </p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-label text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--color-brass)" }} /> life / social
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--color-crimson)" }} /> illness / death / breakdown
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full border-2" style={{ borderColor: "var(--color-crimson)" }} /> close call (fragile)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full border-2 border-dashed" style={{ borderColor: "var(--color-brass)" }} /> long shot (surprise)
        </span>
        <span>dashed lane = moved away</span>
        <span>hover a name = relationships</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 normal-case tracking-normal">
          <input type="checkbox" checked={showAllRolls} onChange={(e) => setShowAllRolls(e.target.checked)} className="h-3 w-3 cursor-pointer" />
          show all rolls
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="flex" style={{ minWidth: width + LABEL_WIDTH }}>
          <div className="sticky left-0 z-10 shrink-0 border-r border-border bg-card" style={{ width: LABEL_WIDTH }}>
            <div style={{ height: TOP_PADDING }} />
            {laneOrder.map((id) => {
              const person = byId.get(id);
              if (!person) return null;
              const changed = diffedPeopleIds.has(id);
              return (
                <Link
                  key={id}
                  href={`/world/${worldId}/person/${id}?branch=${branchId}`}
                  style={{ height: LANE_HEIGHT }}
                  className={`flex items-center truncate px-2 text-xs hover:text-brass ${changed ? "font-semibold text-brass" : "text-foreground"}`}
                  title={person.name}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseLeave={() => setHoveredId((current) => (current === id ? null : current))}
                >
                  {person.name}
                </Link>
              );
            })}
          </div>

          <svg width={width} height={height} role="img" aria-label={`${townName} timeline, ${startYear} to ${endYear}`}>
            {/* Decade gridlines */}
            {Array.from({ length: Math.floor((endYear - startYear) / 10) + 1 }, (_, i) => startYear + i * 10).map((year) => (
              <g key={year}>
                <line x1={x(year)} y1={0} x2={x(year)} y2={height} stroke="var(--color-border)" strokeWidth={1} opacity={0.5} />
                <text x={x(year) + 2} y={12} fontSize={9} fill="var(--color-muted-foreground)">
                  {year}
                </text>
              </g>
            ))}

            {/* Ghost (base branch) lanes, dashed and faded */}
            {ghost &&
              ghost.laneOrder.map((id) => {
                const p = ghostById.get(id);
                if (!p || !laneIndex.has(id)) return null;
                const y = laneY(id);
                const startX = x(p.arrivedYear ?? p.birthYear);
                const endX = x(p.deathYear ?? endYear);
                return <line key={`ghost-${id}`} x1={startX} y1={y} x2={endX} y2={y} stroke="var(--color-muted-foreground)" strokeWidth={2} strokeDasharray="3,3" opacity={0.4} />;
              })}

            {/* Marriage bands: a filled ribbon between spouse lanes from the marriage year on, so a marriage reads as a persistent weave, not a hairline tick. */}
            {people.map((p) => {
              if (!p.spouseId || !p.marriageYear || p.id > p.spouseId) return null;
              const other = byId.get(p.spouseId);
              if (!other || !laneIndex.has(p.id) || !laneIndex.has(p.spouseId)) return null;
              const y1 = laneY(p.id);
              const y2 = laneY(p.spouseId);
              const startX = x(p.marriageYear);
              const endYForBand = x(Math.min(p.deathYear ?? endYear, other.deathYear ?? endYear));
              const adjacent = Math.abs(laneIndex.get(p.id)! - laneIndex.get(p.spouseId)!) === 1;
              return (
                <g key={`marriage-${p.id}`}>
                  {adjacent && <rect x={startX} y={Math.min(y1, y2)} width={Math.max(1, endYForBand - startX)} height={Math.abs(y2 - y1)} fill="var(--color-brass)" opacity={0.08} />}
                  <line x1={startX} y1={y1} x2={startX} y2={y2} stroke="var(--color-brass)" strokeWidth={2} opacity={0.8} />
                </g>
              );
            })}

            {/* Birth connectors: a curved path from the mother's lane to the child's, so a new lane visibly branches out. */}
            {people.map((p) => {
              if (!p.motherId || !laneIndex.has(p.motherId) || !laneIndex.has(p.id)) return null;
              const bx = x(p.birthYear);
              const my = laneY(p.motherId);
              const cy = laneY(p.id);
              const midX = bx + 14;
              return <path key={`birth-${p.id}`} d={`M ${bx} ${my} C ${midX} ${my}, ${midX} ${cy}, ${bx + 20} ${cy}`} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.25} opacity={0.5} />;
            })}

            {/* Relationship hover arcs (round 4 fix B3): only drawn for the hovered person's friend/grudge/rival ties. */}
            {hoveredId &&
              laneIndex.has(hoveredId) &&
              hoveredRelationships.map((r) => {
                const y1 = laneY(hoveredId);
                const y2 = laneY(r.personId);
                const midYear = Math.round((startYear + endYear) / 2);
                const midX = x(midYear);
                const positive = r.bond === "friend";
                return (
                  <path
                    key={`rel-${hoveredId}-${r.personId}`}
                    d={`M ${x(startYear)} ${y1} Q ${midX} ${(y1 + y2) / 2}, ${x(startYear)} ${y2}`}
                    fill="none"
                    stroke={positive ? "var(--color-brass)" : "var(--color-crimson)"}
                    strokeWidth={1.5}
                    strokeDasharray={positive ? undefined : "3,2"}
                    opacity={0.6}
                  />
                );
              })}

            {/* Lanes */}
            {people.map((p) => {
              if (!laneIndex.has(p.id)) return null;
              const y = laneY(p.id);
              const startX = x(p.arrivedYear ?? p.birthYear);
              const endX = x(p.deathYear ?? endYear);
              const changed = diffedPeopleIds.has(p.id);
              return (
                <motion.line
                  key={p.id}
                  x1={startX}
                  y1={y}
                  x2={endX}
                  y2={y}
                  stroke={changed ? "var(--color-brass)" : laneColor(p)}
                  strokeWidth={changed ? 3 : 2}
                  strokeDasharray={p.movedAway ? "4,3" : undefined}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                />
              );
            })}

            {/* Immigrant arrival markers */}
            {people.map((p) => (p.arrivedYear !== null && laneIndex.has(p.id) ? <circle key={`arrive-${p.id}`} cx={x(p.arrivedYear)} cy={laneY(p.id)} r={3} fill="var(--color-brass)" /> : null))}

            {/* Death markers */}
            {people.map((p) =>
              p.deathYear !== null && laneIndex.has(p.id) ? (
                <text key={`death-${p.id}`} x={x(p.deathYear) + 2} y={laneY(p.id) + 3} fontSize={10} fill="var(--color-crimson)">
                  &#8224;
                </text>
              ) : null,
            )}

            {/* Decision dots */}
            {[...visibleDecisionsByPerson.entries()].map(([personId, ds]) =>
              laneIndex.has(personId)
                ? ds.map((d) => {
                    const fragile = isFragile(d);
                    const radius = d.source === "forced" ? 4.5 : d.resultingEventIds.length > 0 ? 3.2 : 2;
                    return (
                      <motion.circle
                        key={d.id}
                        cx={x(d.year)}
                        cy={laneY(personId)}
                        r={radius}
                        fill={d.source === "forced" ? "var(--color-brass)" : dotColor(d.kind)}
                        stroke={fragile ? "var(--color-crimson)" : d.surprise ? "var(--color-brass)" : "var(--color-card)"}
                        strokeWidth={fragile || d.surprise ? 1.5 : 0.75}
                        strokeDasharray={d.surprise && !fragile ? "1.5,1" : undefined}
                        className="cursor-pointer"
                        whileHover={{ scale: 1.6 }}
                        onClick={() => setSelected(d)}
                      />
                    );
                  })
                : null,
            )}
          </svg>
        </div>
      </div>

      {forking && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-3 rounded-lg border border-brass/40 bg-card p-6 text-center">
            <p className="font-label text-xs uppercase tracking-widest text-brass">Forking the timeline</p>
            <p className="text-sm text-muted-foreground">
              Year {forking.year} &middot; population {forking.population}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full bg-brass" initial={{ width: "0%" }} animate={{ width: `${Math.min(100, ((forking.year - startYear) / (endYear - startYear)) * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto border-t border-brass/40 bg-card p-5 shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-h-[80vh] sm:w-96 sm:rounded-lg sm:border">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="font-label text-[10px] uppercase tracking-widest text-muted-foreground">
                {selected.year} &middot; {selected.kind} &middot; {selected.source}
              </p>
              <h3 className="font-heading text-lg font-semibold">{selected.question}</h3>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="cursor-pointer text-muted-foreground hover:text-brass">
              &times;
            </button>
          </div>

          <div className="mb-2 flex gap-1.5">
            {isFragile(selected) && <span className="inline-block rounded-full bg-crimson/15 px-2 py-0.5 font-label text-[10px] uppercase tracking-widest text-crimson">Close call</span>}
            {selected.surprise && <span className="inline-block rounded-full bg-brass/15 px-2 py-0.5 font-label text-[10px] uppercase tracking-widest text-brass">Long shot</span>}
          </div>

          <div className="space-y-2">
            {selected.options.map((option) => {
              const finalP = selected.final[option.id] ?? 0;
              const jevP = selected.jevRaw?.[option.id];
              const priorP = selected.prior?.[option.id];
              const isChosen = option.id === selected.chosen;
              return (
                <div key={option.id} className="text-xs">
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className={isChosen ? "font-semibold text-brass" : "text-foreground"}>
                      {option.label} {isChosen && "✓"}
                    </span>
                    <span className="text-muted-foreground">{(finalP * 100).toFixed(0)}%</span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-brass" style={{ width: `${finalP * 100}%` }} />
                    {jevP !== undefined && <div className="absolute top-0 h-full w-0.5 bg-crimson" style={{ left: `${jevP * 100}%` }} title={`Jev: ${(jevP * 100).toFixed(0)}%`} />}
                    {priorP !== undefined && <div className="absolute top-0 h-full w-0.5 bg-foreground/60" style={{ left: `${priorP * 100}%` }} title={`Rule prior: ${(priorP * 100).toFixed(0)}%`} />}
                  </div>
                  {!isChosen && selected.source !== "forced" && (
                    <button
                      type="button"
                      onClick={() => chooseInstead(option.id)}
                      className="mt-1 cursor-pointer font-label text-[10px] uppercase tracking-widest text-brass underline-offset-4 hover:underline"
                    >
                      Choose this instead &rarr;
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {forkError && <p className="mt-3 text-xs text-crimson">{forkError}</p>}

          {selected.causes.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-1 font-label text-[10px] uppercase tracking-widest text-muted-foreground">Why did this come up?</p>
              <p className="text-xs text-muted-foreground">Caused by {selected.causes.length} earlier event(s). See the person&apos;s chronicle for the full &ldquo;why?&rdquo; chain.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
