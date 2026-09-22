"use client";

/**
 * The pre-pivot, multi-protagonist Living Chronicle (decisions 029-033), kept working verbatim
 * for the legacy `/world/[worldId]/person/[personId]` route (decision 041 — the single-life pivot
 * moved `src/components/chronicle.tsx` onto the new `src/contracts/life.ts` contract, which this
 * older page's data layer, `src/server/chronicle-data.ts`, doesn't produce). Not modified beyond
 * the rename from `Chronicle`/`ChronicleData` to `LegacyChronicle`/`LegacyChronicleData`, so it
 * can live alongside the new component without a name clash.
 */

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { streamSSE } from "@/lib/sse";
import { ThemeToggle } from "@/components/theme-toggle";
import { isChoiceDecision, isRealTurn } from "@/domain/chronicle-view";

export interface LegacyChronicleCause {
  readonly eventId: string;
  readonly phrase: string;
  readonly year: number;
  readonly inThisLife: boolean;
}

export interface LegacyChronicleDecision {
  readonly id: string;
  readonly question: string;
  readonly options: readonly { id: string; label: string }[];
  readonly chosen: string;
  readonly fragility: number;
  readonly surprise: boolean;
  readonly source: string;
  readonly final: Readonly<Record<string, number>>;
}

export interface LegacyChronicleEntry {
  readonly eventId: string;
  readonly year: number;
  readonly kind: string;
  readonly actors: readonly string[];
  readonly title: string;
  readonly prose: string;
  readonly isKeyMoment: boolean;
  readonly causes: readonly LegacyChronicleCause[];
  readonly decision: LegacyChronicleDecision | null;
}

export interface LegacyChronicleRelationship {
  readonly personId: string;
  readonly name: string;
  readonly relation: string;
  readonly strength: number | null;
}

export interface LegacyChronicleBranch {
  readonly id: string;
  readonly label: string;
  readonly forkYear: number | null;
  readonly parentBranchId: string | null;
}

export interface LegacyChronicleData {
  readonly worldId: string;
  readonly branchId: string;
  readonly townName: string;
  readonly person: { id: string; name: string; sex: "f" | "m"; birthYear: number; deathYear?: number; alive: boolean; age: number; job: string };
  readonly lifeSummary: string;
  readonly relationships: readonly LegacyChronicleRelationship[];
  readonly branches: readonly LegacyChronicleBranch[];
  readonly currentBranch: { id: string; label: string; forkYear: number | null };
  readonly timeline: readonly LegacyChronicleEntry[];
}

function describeChance(d: LegacyChronicleDecision, subject: string): string {
  if (d.source === "forced") return "This moment was rewritten directly.";
  const choice = isChoiceDecision(d);

  const probs = Object.values(d.final);
  const sorted = [...probs].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const nearEven = second > 0 && top - second < 0.15;

  if (d.surprise) return choice ? "This was an unlikely choice — the odds favored something else." : "Against the odds — the odds favored something else.";
  if (nearEven) return "Either outcome was plausible.";
  if (d.fragility < 1) return choice ? `${subject} almost chose otherwise.` : "It could easily have gone otherwise.";
  return choice ? "This was a fairly clear-cut choice." : "This was a fairly likely outcome.";
}

function chosenTag(label: string, fullName: string, sex: "f" | "m"): string {
  const pronoun = sex === "f" ? "She" : "He";
  if (label.startsWith(fullName)) return pronoun + label.slice(fullName.length);
  const firstName = fullName.split(" ")[0];
  if (firstName && label.startsWith(firstName)) return pronoun + label.slice(firstName.length);
  return label;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function humanizeBranchLabel(forkYear: number | null): string {
  return forkYear === null ? "Original life" : `Changed in ${forkYear}`;
}

function EndingParagraph({ summary }: { summary: string }) {
  const sentences = summary.split(/(?<=\.)\s+/).filter(Boolean);
  if (sentences.length <= 1) return <p className="cw-ending">{summary}</p>;
  const last = sentences.pop()!;
  return (
    <p className="cw-ending">
      {sentences.join(" ")} <strong>{last}</strong>
    </p>
  );
}

function ChangeModal({
  decision,
  entryTitle,
  entryYear,
  personName,
  sex,
  onClose,
  onChoose,
  busy,
}: {
  decision: LegacyChronicleDecision;
  entryTitle: string;
  entryYear: number;
  personName: string;
  sex: "f" | "m";
  onClose: () => void;
  onChoose: (optionId: string) => void;
  busy: boolean;
}) {
  const [showNumbers, setShowNumbers] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const choice = isChoiceDecision(decision);
  const subject = sex === "f" ? "She" : "He";
  const chosenLabel = decision.options.find((o) => o.id === decision.chosen)?.label ?? decision.chosen;
  const others = decision.options.filter((o) => o.id !== decision.chosen);
  const header = `${personName} ${lowerFirst(entryTitle)}.`;

  return (
    <div className="cw-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="cw-modal-card cw-sheet-on-mobile"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cw-modal-kicker">Change this moment</div>
        <h2>{header}</h2>

        <p style={{ marginBottom: 6, fontFamily: "var(--font-crimson), Georgia, serif", fontSize: 13, color: "var(--cw-muted)" }}>What happened:</p>
        <div className="cw-options" style={{ marginBottom: 16 }}>
          <div className="cw-option-btn cw-current" style={{ cursor: "default" }}>
            <span>✓ {chosenLabel}</span>
          </div>
        </div>

        <p style={{ marginBottom: 6, fontFamily: "var(--font-crimson), Georgia, serif", fontSize: 13, color: "var(--cw-muted)" }}>Other possibilities:</p>
        <div className="cw-options">
          {others.map((o) => (
            <button key={o.id} type="button" disabled={busy} onClick={() => setSelected(o.id)} className={`cw-option-btn${selected === o.id ? " cw-selected" : ""}`}>
              <span>○ {o.label}</span>
            </button>
          ))}
        </div>

        <p style={{ margin: "16px 0 0", color: "var(--cw-muted)", font: "15px/1.6 Georgia, serif" }}>Everything after {entryYear} will be simulated again.</p>

        <div className="cw-modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected || busy}
            onClick={() => selected && onChoose(selected)}
            style={{
              background: selected ? "var(--cw-accent)" : "transparent",
              color: selected ? "var(--cw-white)" : "var(--cw-faint)",
              border: `1px solid ${selected ? "var(--cw-accent)" : "var(--cw-rule)"}`,
              borderRadius: 4,
              padding: "8px 16px",
              cursor: selected ? "pointer" : "not-allowed",
            }}
          >
            Rewrite from here
          </button>
        </div>

        <details className="cw-why" open={showNumbers} onToggle={(e) => setShowNumbers((e.target as HTMLDetailsElement).open)}>
          <summary>{choice ? `Why did ${subject.toLowerCase()} choose this?` : "Why did this happen?"}</summary>
          <p>{describeChance(decision, subject)}</p>
          {showNumbers && (
            <ul style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12, color: "var(--cw-muted)" }}>
              {decision.options.map((o) => (
                <li key={o.id} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{o.label}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round((decision.final[o.id] ?? 0) * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </motion.div>
    </div>
  );
}

interface StreamedTurn {
  readonly eventId: string;
  readonly year: number;
  readonly label: string;
}

interface RewriteState {
  readonly phase: "A" | "B" | "C";
  readonly divergenceYear: number;
  readonly originalLabel: string;
  readonly newLabel: string;
  readonly tickYear: number;
  readonly population: number;
  readonly streamed: readonly StreamedTurn[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function LegacyChronicle({ initial }: { initial: LegacyChronicleData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [openDecision, setOpenDecision] = useState<LegacyChronicleEntry | null>(null);
  const [rewrite, setRewrite] = useState<RewriteState | null>(null);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [ghostNote, setGhostNote] = useState<{ year: number; original: string } | null>(null);
  const [diffGhosts, setDiffGhosts] = useState<ReadonlyMap<number, string>>(new Map());
  const [justInked, setJustInked] = useState(false);
  const [peopleDrawerOpen, setPeopleDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const p = data.person;
  const divergenceYear = rewrite?.divergenceYear ?? null;

  async function applyChoice(optionId: string): Promise<void> {
    if (!openDecision?.decision) return;
    const decision = openDecision.decision;
    const year = openDecision.year;
    const originalLabel = decision.options.find((o) => o.id === decision.chosen)?.label ?? decision.chosen;
    const newLabel = decision.options.find((o) => o.id === optionId)?.label ?? optionId;
    const preRewriteData = data;
    setRewriteError(null);
    setOpenDecision(null);
    setGhostNote(null);
    setDiffGhosts(new Map());

    setRewrite({ phase: "A", divergenceYear: year, originalLabel, newLabel, tickYear: year, population: 0, streamed: [] });
    document.getElementById(`event-${openDecision.eventId}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    await sleep(reduceMotion ? 200 : 1600);

    setRewrite((r) => (r ? { ...r, phase: "B" } : r));
    await sleep(reduceMotion ? 100 : 900);

    setRewrite((r) => (r ? { ...r, phase: "C" } : r));
    try {
      let newBranchId: string | undefined;
      await streamSSE(`/api/worlds/${data.worldId}/edit/stream`, { branchId: data.branchId, override: { decisionId: decision.id, optionId } }, (event, payload) => {
        if (event === "tick") {
          const d = payload as { year: number; population: number; newDecisions?: { id: string; personId: string; options: { id: string; label: string }[]; chosen: string; resultingEventIds: string[] }[] };
          const mine = (d.newDecisions ?? []).filter((dec) => dec.personId === p.id && dec.resultingEventIds.length > 0);
          const newTurns: StreamedTurn[] = mine.map((dec) => ({ eventId: dec.id, year: d.year, label: dec.options.find((o) => o.id === dec.chosen)?.label ?? dec.chosen }));
          setRewrite((r) => (r ? { ...r, tickYear: d.year, population: d.population, streamed: [...r.streamed, ...newTurns] } : r));
        } else if (event === "done") {
          newBranchId = (payload as { branchId: string }).branchId;
        } else if (event === "error") {
          throw new Error((payload as { message: string }).message);
        }
      });

      if (newBranchId) {
        const res = await fetch(`/api/worlds/${data.worldId}/people/${p.id}?branchId=${newBranchId}`);
        if (!res.ok) throw new Error("Couldn't load the rewritten life.");
        const fresh = (await res.json()) as LegacyChronicleData;

        const ghosts = new Map<number, string>();
        for (const entry of fresh.timeline) {
          if (entry.year <= year || ghosts.size >= 2) continue;
          const wasEntry = preRewriteData.timeline.find((e) => Math.abs(e.year - entry.year) <= 1 && e.eventId !== entry.eventId && e.title !== entry.title);
          if (wasEntry) ghosts.set(entry.year, `In the original life, ${lowerFirst(wasEntry.title)} (${wasEntry.year}).`);
        }
        setDiffGhosts(ghosts);

        setData(fresh);
        setGhostNote({ year, original: originalLabel });
        setJustInked(true);
        setTimeout(() => setJustInked(false), 1200);
        router.replace(`/world/${data.worldId}/person/${p.id}?branch=${newBranchId}`, { scroll: false });
        setTimeout(() => {
          const divergenceEntry = fresh.timeline.find((e) => e.year === year);
          if (divergenceEntry) document.getElementById(`event-${divergenceEntry.eventId}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        }, 100);
      }
    } catch (err) {
      setRewriteError(err instanceof Error ? err.message : "The rewrite failed.");
    } finally {
      setRewrite(null);
    }
  }

  function switchPerson(personId: string): void {
    router.push(`/world/${data.worldId}/person/${personId}?branch=${data.branchId}`);
  }

  const closureLink = data.relationships.find((r) => r.relation === "husband" || r.relation === "wife") ?? data.relationships.find((r) => r.relation === "son" || r.relation === "daughter");

  const keyTurns = [data.timeline[0], ...data.timeline.filter((e) => e.isKeyMoment), data.timeline[data.timeline.length - 1]]
    .filter((e, i, arr): e is LegacyChronicleEntry => !!e && arr.findIndex((x) => x?.eventId === e.eventId) === i)
    .slice(0, 5);

  return (
    <div className="cw-app">
      <header className="cw-topbar">
        <button type="button" className="cw-brand" onClick={() => router.push(`/world/${data.worldId}?branch=${data.branchId}`)}>
          <span className="cw-mark">∞</span> LIFELINES
        </button>
        <div className="cw-top-actions">
          <button type="button" onClick={() => setPeopleDrawerOpen(true)}>
            People
          </button>
          <Link href={`/world/${data.worldId}/town?branch=${data.branchId}`}>{data.townName}</Link>
          <button type="button" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          <Link href={`/world/${data.worldId}?branch=${data.branchId}`}>Tapestry</Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="cw-page">
        <aside className="cw-left">
          <div className="cw-rail-label">People in this life</div>
          <div className="cw-cast">
            {data.relationships.slice(0, 8).map((r) => (
              <button key={r.personId} type="button" className="cw-person-link" onClick={() => switchPerson(r.personId)}>
                {r.name}
                <small>{r.relation}</small>
              </button>
            ))}
          </div>
          <div className="cw-chapter">Every name in the chronicle can become the center of the story.</div>
        </aside>

        <article className="cw-chronicle" id="chronicle">
          <section className="cw-hero">
            <div className="cw-eyebrow">A life already lived</div>
            <h1 className="cw-h1">{p.name}</h1>
            <div className="cw-years">
              {p.birthYear} — {p.deathYear ?? "living"}
            </div>
            <EndingParagraph summary={data.lifeSummary} />
          </section>

          {rewriteError && (
            <p style={{ margin: "16px 70px 0", color: "var(--ll-danger)", fontFamily: "var(--font-crimson), Georgia, serif", fontSize: 13 }}>{rewriteError}</p>
          )}

          <ol className="cw-timeline" style={{ listStyle: "none", margin: 0 }}>
            {data.timeline.map((entry, i) => {
              const isDivergenceEntry = rewrite !== null && entry.year === divergenceYear;
              const isFuture = rewrite !== null && rewrite.phase !== "A" && divergenceYear !== null && entry.year > divergenceYear;
              const isChangedNow = ghostNote !== null && entry.year === ghostNote.year;
              const isNewbornNow = justInked && divergenceYear === null && ghostNote !== null && entry.year >= ghostNote.year;
              const diffGhost = diffGhosts.get(entry.year);
              return (
                <li
                  key={entry.eventId}
                  id={`event-${entry.eventId}`}
                  className={`cw-event${isFuture ? " cw-rewriting" : ""}${isChangedNow ? " cw-changed" : ""}${isNewbornNow ? " cw-newborn" : ""}`}
                  style={isFuture ? { transitionDelay: reduceMotion ? "0ms" : `${i * 20}ms` } : isNewbornNow ? { animationDelay: `${Math.min(i, 10) * 60}ms` } : undefined}
                >
                  <div className="cw-year">{entry.year}</div>
                  <div className="cw-event-content">
                    {isDivergenceEntry && rewrite.phase === "A" ? (
                      <div className="cw-divergence">
                        <div className="cw-divergence-mark">◆ history diverges here</div>
                        <div className="cw-divergence-row">
                          <span className="cw-divergence-label">ORIGINAL</span>
                          <span>{rewrite.originalLabel}</span>
                        </div>
                        <div className="cw-divergence-row cw-divergence-new">
                          <span className="cw-divergence-label">NEW</span>
                          <span>{rewrite.newLabel}</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h2 className="cw-event-title">{entry.title}</h2>
                        <p className="cw-event-text">
                          <EntryProse prose={entry.prose} people={data.relationships} onNavigate={switchPerson} />
                        </p>

                        {entry.decision && entry.decision.options.length > 1 && isRealTurn(entry.decision) && (
                          <div className="cw-decision">
                            <span className="cw-chosen">{chosenTag(entry.decision.options.find((o) => o.id === entry.decision!.chosen)?.label ?? entry.decision.chosen, p.name, p.sex)}</span>
                            <button type="button" className="cw-change-btn" disabled={!!rewrite} onClick={() => setOpenDecision(entry)}>
                              ◇ change what happened
                            </button>
                          </div>
                        )}

                        {entry.causes.length > 0 && (
                          <div className="cw-cause">
                            {entry.causes.map((c, ci) => (
                              <span key={c.eventId}>
                                {ci > 0 && "; "}
                                {"↳ "}
                                {c.inThisLife ? (
                                  <a href={`#event-${c.eventId}`} className="cw-cause-link">
                                    Follows {c.phrase} ({c.year})
                                  </a>
                                ) : (
                                  <>
                                    Follows {c.phrase} ({c.year})
                                  </>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        {isChangedNow && <div className="cw-ghost-note">Original history: {ghostNote.original}</div>}
                        {!isChangedNow && diffGhost && <div className="cw-ghost-note">{diffGhost}</div>}
                      </>
                    )}
                  </div>
                </li>
              );
            })}

            {rewrite && rewrite.phase === "C" && (
              <>
                {Array.from({ length: Math.min(3, Math.max(0, rewrite.tickYear - rewrite.divergenceYear - rewrite.streamed.length)) }, (_, gi) => (
                  <li key={`ghost-${gi}`} className="cw-event cw-ghost-year">
                    <div className="cw-year">{rewrite.divergenceYear + 1 + gi}</div>
                    <div className="cw-event-content">
                      <p className="cw-event-text">…</p>
                    </div>
                  </li>
                ))}
                {rewrite.streamed.map((s, si) => (
                  <li key={s.eventId} className="cw-event cw-newborn" style={{ animationDelay: `${si * 80}ms` }}>
                    <div className="cw-year">{s.year}</div>
                    <div className="cw-event-content">
                      <p className="cw-event-text" style={{ fontStyle: "italic" }}>
                        {s.label}
                      </p>
                    </div>
                  </li>
                ))}
              </>
            )}
          </ol>

          {p.deathYear !== undefined && (
            <section className="cw-timeline" style={{ paddingTop: 0, textAlign: "center" }}>
              <div style={{ margin: "0 auto 18px", color: "var(--cw-accent)", font: "600 12px/1.2 var(--font-crimson), Georgia, serif", letterSpacing: "0.16em" }}>◆ END OF LIFE</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap", fontFamily: "var(--font-crimson), Georgia, serif", fontSize: 13 }}>
                {closureLink && (
                  <button type="button" onClick={() => switchPerson(closureLink.personId)} className="cw-change-btn" style={{ borderColor: "var(--cw-rule)" }}>
                    View {closureLink.name.split(" ")[0]}&apos;s life
                  </button>
                )}
                <Link href={`/world/${data.worldId}?branch=${data.branchId}`} className="cw-change-btn" style={{ borderColor: "var(--cw-rule)" }}>
                  Return to {data.townName}
                </Link>
                <button
                  type="button"
                  className="cw-change-btn"
                  style={{ borderColor: "var(--cw-rule)" }}
                  onClick={() => {
                    const last = [...data.timeline].reverse().find((e) => e.decision && e.decision.options.length > 1 && isRealTurn(e.decision));
                    if (last) setOpenDecision(last);
                  }}
                >
                  Change an earlier moment
                </button>
              </div>
            </section>
          )}
        </article>

        <aside className="cw-right">
          <div className="cw-rail-label">This history</div>
          <div className="cw-branch-box">
            <div className="cw-branch-name">{humanizeBranchLabel(data.currentBranch.forkYear)}</div>
            <div className="cw-branch-sub">{data.currentBranch.forkYear ? `Changed at ${data.currentBranch.forkYear}. The original life still exists as another branch.` : "The life that was first simulated."}</div>
            <div className="cw-branch-list">
              {keyTurns.map((t) => (
                <button key={t.eventId} type="button" className={`cw-branch-item${divergenceYear === t.year ? " cw-active" : ""}`} onClick={() => document.getElementById(`event-${t.eventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                  {t.year} · {t.title}
                </button>
              ))}
            </div>
            <div className="cw-footer-note">Change any turn and everything after it can be rewritten.</div>
          </div>
        </aside>
      </main>

      {rewrite && rewrite.phase !== "A" && (
        <div className="cw-regen">
          <span className="cw-regen-dot" />
          <span>
            Rewriting {p.name.split(" ")[0]}&apos;s life from {rewrite.divergenceYear}&hellip; now at {rewrite.tickYear} ({rewrite.population} living)
          </span>
        </div>
      )}

      <AnimatePresence>
        {openDecision?.decision && (
          <ChangeModal
            decision={openDecision.decision}
            entryTitle={openDecision.title}
            entryYear={openDecision.year}
            personName={p.name}
            sex={p.sex}
            onClose={() => setOpenDecision(null)}
            onChoose={applyChoice}
            busy={!!rewrite}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {peopleDrawerOpen && (
          <PeopleDrawer worldId={data.worldId} branchId={data.branchId} townName={data.townName} relationships={data.relationships} onClose={() => setPeopleDrawerOpen(false)} onNavigate={switchPerson} />
        )}
        {historyOpen && <HistoryDrawer data={data} personId={p.id} onClose={() => setHistoryOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

function EntryProse({ prose, people, onNavigate }: { prose: string; people: readonly LegacyChronicleRelationship[]; onNavigate: (personId: string) => void }) {
  const known = [...people].sort((a, b) => b.name.length - a.name.length);
  if (known.length === 0) return <>{prose}</>;

  const parts: (string | { name: string; personId: string })[] = [prose];
  for (const person of known) {
    const next: typeof parts = [];
    for (const part of parts) {
      if (typeof part !== "string") {
        next.push(part);
        continue;
      }
      const segments = part.split(person.name);
      segments.forEach((seg, i) => {
        if (i > 0) next.push({ name: person.name, personId: person.personId });
        if (seg) next.push(seg);
      });
    }
    parts.length = 0;
    parts.push(...next);
  }

  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : (
          <a
            key={i}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onNavigate(part.personId);
            }}
          >
            {part.name}
          </a>
        ),
      )}
    </>
  );
}

function PeopleDrawer({
  worldId,
  branchId,
  townName,
  relationships,
  onClose,
  onNavigate,
}: {
  worldId: string;
  branchId: string;
  townName: string;
  relationships: readonly LegacyChronicleRelationship[];
  onClose: () => void;
  onNavigate: (personId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = relationships.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
  void worldId;
  void branchId;
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="cw-drawer-backdrop" onClick={onClose} />
      <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ duration: 0.25, ease: "easeOut" }} className="cw-drawer-panel">
        <div className="cw-modal-kicker">{townName}</div>
        <h2>People</h2>
        <input className="cw-drawer-search" placeholder="Find a life…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {filtered.map((r) => (
          <button
            key={r.personId}
            type="button"
            className="cw-drawer-person"
            onClick={() => {
              onNavigate(r.personId);
              onClose();
            }}
          >
            {r.name}
            <small>{r.relation}</small>
          </button>
        ))}
        {filtered.length === 0 && <p style={{ color: "var(--cw-muted)", fontSize: 13, marginTop: 12 }}>No one found.</p>}
      </motion.div>
    </>
  );
}

function HistoryDrawer({ data, personId, onClose }: { data: LegacyChronicleData; personId: string; onClose: () => void }) {
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="cw-drawer-backdrop" onClick={onClose} />
      <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ duration: 0.25, ease: "easeOut" }} className="cw-drawer-panel">
        <div className="cw-modal-kicker">Branches</div>
        <h2>History</h2>
        {data.branches.map((b) => (
          <Link key={b.id} href={`/world/${data.worldId}/person/${personId}?branch=${b.id}`} className="cw-drawer-person" style={{ display: "block" }} onClick={onClose}>
            {humanizeBranchLabel(b.forkYear)}
          </Link>
        ))}
      </motion.div>
    </>
  );
}
