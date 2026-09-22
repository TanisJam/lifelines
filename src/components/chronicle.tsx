"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Chronicle as ChronicleData, ChronicleEntry, LifeStreamEvent } from "@/contracts/life";
import { getChronicle, rewriteStream } from "@/lib/life-client";
import { parseProseMarkers } from "@/lib/prose-markers";
import { prefersReducedMotion } from "@/lib/viewport";
import { PersonSheet } from "@/components/person-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { CheckCircleIcon, ChevronRightIcon, LeafGlyph, SprigDivider, SunEmblem, VineCorner } from "@/components/ornaments";

/**
 * The question in "Why did she choose this?"/"Why did Tomas Vell choose this?"/"Why did this
 * happen?" — derived from who actually decided (`turn.deciderId`), never assumed. `decidedBy` is
 * already a ready-made phrase ("Tomas Vell's choice") per the contract; stripping the trailing
 * "'s choice" recovers the name for an NPC decider without guessing a pronoun for them.
 */
function whyQuestion(turn: NonNullable<ChronicleEntry["turn"]>, protagonistSex: "f" | "m"): string {
  if (turn.deciderId === "chance") return "Why did this happen?";
  if (turn.deciderId === "self") return `Why did ${protagonistSex === "f" ? "she" : "he"} choose this?`;
  const name = turn.decidedBy.replace(/'s choice$/i, "");
  return `Why did ${name} choose this?`;
}

/**
 * The change sheet (design-system.md §6): a bottom sheet on mobile, a centered card ≥640px
 * (`.cw-sheet-on-mobile` picks the breakpoint). The current history is always the first option,
 * sage-tinted with a check; the rest are plain option cards that arm the primary "Apply this
 * change" button on click — "select first, then confirm" (ui-ux-handoff.md §8), so a stray click
 * can't accidentally rewrite a life.
 */
function ChangeModal({
  entry,
  personSex,
  onClose,
  onChoose,
  busy,
}: {
  entry: ChronicleEntry & { turn: NonNullable<ChronicleEntry["turn"]> };
  personSex: "f" | "m";
  onClose: () => void;
  onChoose: (optionId: string) => void;
  busy: boolean;
}) {
  const [showNumbers, setShowNumbers] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { turn } = entry;

  return (
    <div className="cw-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="cw-modal-card cw-sheet-on-mobile" onClick={(e) => e.stopPropagation()}>
        <VineCorner className="cw-vine-corner cw-vine-left h-7 w-7" />
        <VineCorner className="cw-vine-corner cw-vine-right h-7 w-7" />
        <div className="cw-sheet-grabber" aria-hidden="true" />

        <div className="cw-modal-kicker">{entry.year}</div>
        <h2>{entry.title}</h2>
        <p>Everything after this moment will be rewritten.</p>

        <SprigDivider className="cw-sprig" />

        <p className="cw-sheet-prompt">How does this moment unfold?</p>
        <div className="cw-options">
          <div className="cw-option-btn cw-current" aria-current="true">
            <LeafGlyph className="cw-option-leaf" />
            <span className="cw-option-label">
              {turn.chosen.label}
              <span className="cw-option-sub">(Current history)</span>
            </span>
            <CheckCircleIcon className="cw-option-chevron" />
          </div>
          {turn.alternatives.map((o) => (
            <button key={o.optionId} type="button" disabled={busy} onClick={() => setSelected(o.optionId)} className={`cw-option-btn${selected === o.optionId ? " cw-selected" : ""}`}>
              <LeafGlyph className="cw-option-leaf" />
              <span className="cw-option-label">{o.label}</span>
              {selected === o.optionId ? <CheckCircleIcon className="cw-option-chevron" /> : <ChevronRightIcon className="cw-option-chevron" />}
            </button>
          ))}
        </div>

        <button type="button" className="cw-primary-btn" disabled={!selected || busy} onClick={() => selected && onChoose(selected)}>
          {busy ? "Rewriting…" : "Apply this change"}
        </button>

        <div className="cw-modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>

        <p className="cw-sheet-quote">A single choice can ripple through a lifetime.</p>

        <details className="cw-why" open={showNumbers} onToggle={(e) => setShowNumbers((e.target as HTMLDetailsElement).open)}>
          <summary>{whyQuestion(turn, personSex)}</summary>
          <p>{turn.whyPhrase}</p>
          {showNumbers && turn.probabilities && (
            <ul style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12, color: "var(--cw-muted)" }}>
              {[turn.chosen, ...turn.alternatives].map((o) => (
                <li key={o.optionId} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{o.label}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round((turn.probabilities?.[o.optionId] ?? 0) * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </motion.div>
    </div>
  );
}

interface RewriteState {
  readonly phase: "A" | "B" | "C";
  readonly divergenceEntryId: string;
  readonly divergenceYear: number;
  readonly originalLabel: string;
  readonly newLabel: string;
  readonly tickYear: number;
  readonly streamed: readonly ChronicleEntry[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function Chronicle({ initial }: { initial: ChronicleData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [openEntry, setOpenEntry] = useState<(ChronicleEntry & { turn: NonNullable<ChronicleEntry["turn"]> }) | null>(null);
  const [rewrite, setRewrite] = useState<RewriteState | null>(null);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState<Readonly<Record<string, string>>>({});
  const [justInked, setJustInked] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const reduceMotion = prefersReducedMotion();

  const p = data.protagonist;
  const divergenceYear = rewrite?.divergenceYear ?? null;
  // Branch ribbon (design-system.md §6): marks that the reader is viewing an alternate history —
  // derived from existing branch data only, never a new field.
  const currentBranch = data.branches.find((b) => b.branchId === data.branchId);

  async function applyChoice(optionId: string): Promise<void> {
    if (!openEntry) return;
    const entry = openEntry;
    const originalLabel = entry.turn.chosen.label;
    const newLabel = [entry.turn.chosen, ...entry.turn.alternatives].find((o) => o.optionId === optionId)?.label ?? optionId;
    setRewriteError(null);
    setOpenEntry(null);
    setGhosts({});

    // Phase A (§10.A): mark the divergence — ORIGINAL/NEW, held for a beat so it registers.
    setRewrite({ phase: "A", divergenceEntryId: entry.id, divergenceYear: entry.year, originalLabel, newLabel, tickYear: entry.year, streamed: [] });
    document.getElementById(`event-${entry.id}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    await sleep(reduceMotion ? 200 : 1600);

    // Phase B (§10.B): invalidate the future — staggered fade/blur/desaturate, via `.cw-rewriting`.
    setRewrite((r) => (r ? { ...r, phase: "B" } : r));
    await sleep(reduceMotion ? 100 : 900);

    // Phase C/D (§10.C/D): stream. Each tick's entries for this person are inked in immediately.
    setRewrite((r) => (r ? { ...r, phase: "C" } : r));
    try {
      let finished = false;
      await rewriteStream(data.lifeId, { branchId: data.branchId, decisionId: entry.turn.decisionId, optionId }, (event: LifeStreamEvent) => {
        if (event.type === "tick") {
          setRewrite((r) => (r ? { ...r, tickYear: event.year, streamed: [...r.streamed, ...event.entries] } : r));
        } else if (event.type === "done") {
          finished = true;
          setData(event.chronicle);
          setGhosts(event.ghosts ?? {});
          setJustInked(true);
          setTimeout(() => setJustInked(false), 1200);
          // North star item 7, "stay on the same page": sync the address bar via the raw History
          // API, never `router.replace`/`router.push`. Next's App Router observes the History API
          // globally, so routing this through Next would re-trigger the URL-keyed loader in
          // `/life/[lifeId]/page.tsx` and refetch from the plain GET endpoint — which doesn't
          // carry `ghosts` — silently overwriting the in-memory state this handler just set. The
          // loader only ever reads the branch it was mounted with (see its own comment); every
          // later branch change, from a rewrite or from `switchBranch` below, updates this
          // component's own state directly and treats the URL as write-only.
          window.history.replaceState(null, "", `/life/${event.chronicle.lifeId}?branch=${event.chronicle.branchId}`);
          // §11, scroll anchoring: the divergence entry's own id can change (it's a different
          // event in the new branch), so re-anchor by YEAR rather than the top of the biography.
          setTimeout(() => {
            const divergenceEntry = event.chronicle.entries.find((e) => e.year === entry.year);
            if (divergenceEntry) document.getElementById(`event-${divergenceEntry.id}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
          }, 100);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      });
      if (!finished) throw new Error("The rewrite didn't complete.");
    } catch (err) {
      setRewriteError(err instanceof Error ? err.message : "The rewrite failed.");
    } finally {
      setRewrite(null);
    }
  }

  function reopenLastTurn(): void {
    const last = [...data.entries].reverse().find((e) => e.turn);
    if (last?.turn) setOpenEntry(last as ChronicleEntry & { turn: NonNullable<ChronicleEntry["turn"]> });
  }

  /**
   * Switches to a different branch of THIS SAME life in place, exactly like the end of a rewrite
   * (fetch, `setData`, sync the address bar) — never `router.push`/`router.replace`. Next's App
   * Router observes the History API globally (even a raw `history.replaceState` call), so routing
   * a branch change through it remounts the URL-keyed loader in `/life/[lifeId]/page.tsx` and
   * silently discards this component's own in-memory state (`ghosts`, in particular — a real bug
   * caught live: after a rewrite settled correctly, `router.replace` would re-fetch the branch a
   * moment later from the plain GET endpoint, which doesn't carry `ghosts`, wiping them out).
   */
  async function switchBranch(branchId: string): Promise<void> {
    setHistoryOpen(false);
    if (branchId === data.branchId || rewrite) return;
    setOpenEntry(null);
    setRewriteError(null);
    try {
      const fresh = await getChronicle(data.lifeId, branchId);
      setData(fresh);
      setGhosts({});
      window.history.replaceState(null, "", `/life/${fresh.lifeId}?branch=${fresh.branchId}`);
    } catch (err) {
      setRewriteError(err instanceof Error ? err.message : "Couldn't load that branch.");
    }
  }

  const isDead = typeof p.deathYear === "number";
  const afterDeathPronoun = p.sex === "f" ? "her" : "his";

  return (
    <div className="cw-app">
      <header className="cw-topbar">
        <button type="button" className="cw-brand" onClick={() => router.push("/lives")}>
          <SunEmblem className="cw-mark" /> Lifelines
        </button>
        <div className="cw-top-actions">
          <button type="button" onClick={() => setHistoryOpen(true)}>
            History ▾
          </button>
          <button type="button" onClick={() => router.push("/")}>
            New life
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="cw-page">
        <aside className="cw-left">
          <div className="cw-rail-label">People in this life</div>
          <div className="cw-cast">
            {data.cast.map((c) => (
              <button key={c.personId} type="button" className="cw-person-link" onClick={() => setOpenPersonId(c.personId)}>
                {c.name}
                <small>{c.relation}</small>
              </button>
            ))}
          </div>
        </aside>

        <article className="cw-chronicle" id="chronicle">
          <section className="cw-hero">
            <VineCorner className="cw-vine-corner cw-vine-left h-9 w-9" />
            <VineCorner className="cw-vine-corner cw-vine-right h-9 w-9" />
            <div className="cw-eyebrow">A life already lived</div>
            <h1 className="cw-h1">{p.name}</h1>
            <div className="cw-years">
              {p.birthYear} — {isDead ? p.deathYear : "living"}
            </div>
            {currentBranch?.forkYear != null && (
              <div className="cw-branch-ribbon">
                <SunEmblem className="h-3.5 w-3.5" aria-hidden="true" />
                Branch from {currentBranch.forkYear}
              </div>
            )}
            <SprigDivider className="cw-sprig" />
            <p className="cw-ending">
              <EntryProse prose={data.summary} links={data.summaryLinks} onOpenPerson={setOpenPersonId} />
            </p>
          </section>

          {rewriteError && <p className="text-ll-danger font-body" style={{ margin: "16px 70px 0", fontSize: 13 }}>{rewriteError}</p>}

          <ol className="cw-timeline" style={{ listStyle: "none", margin: 0 }}>
            {data.entries.map((entry, i) => {
              const isDivergenceEntry = rewrite !== null && entry.id === rewrite.divergenceEntryId;
              const isFuture = rewrite !== null && rewrite.phase !== "A" && divergenceYear !== null && entry.year > divergenceYear;
              const isNewbornNow = justInked && ghosts[entry.id] !== undefined;
              const ghostNote = ghosts[entry.id];
              const isTurn = !!entry.turn;
              return (
                <li
                  key={entry.id}
                  id={`event-${entry.id}`}
                  className={`cw-event${isTurn ? " cw-turn" : ""}${isFuture ? " cw-rewriting" : ""}${isNewbornNow ? " cw-newborn" : ""}`}
                  style={isFuture ? { transitionDelay: reduceMotion ? "0ms" : `${i * 20}ms` } : isNewbornNow ? { animationDelay: `${Math.min(i, 10) * 60}ms` } : undefined}
                >
                  <div className="cw-year">
                    {entry.year}
                    {entry.endYear ? `–${entry.endYear}` : ""}
                  </div>
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
                        {/* Three event levels (ui-ux-handoff.md §7): only a level-3 turn ever gets
                            the highlighted turning-point card — the contract guarantees `turn` is
                            present on level 3 only. */}
                        {isTurn ? (
                          <div className="cw-turn-card">
                            <h2 className="cw-event-title">{entry.title}</h2>
                            <p className="cw-event-text">
                              <EntryProse prose={entry.prose} links={entry.links} onOpenPerson={setOpenPersonId} />
                            </p>
                            <button type="button" className="cw-turn-link" disabled={!!rewrite} onClick={() => setOpenEntry(entry as ChronicleEntry & { turn: NonNullable<ChronicleEntry["turn"]> })}>
                              Change what happened →
                            </button>
                          </div>
                        ) : (
                          <>
                            <h2 className="cw-event-title">{entry.title}</h2>
                            <p className="cw-event-text">
                              <EntryProse prose={entry.prose} links={entry.links} onOpenPerson={setOpenPersonId} />
                            </p>
                          </>
                        )}

                        {entry.cause && (
                          <div className="cw-cause">
                            {"↳ "}
                            {entry.cause.entryId ? (
                              <a href={`#event-${entry.cause.entryId}`} className="cw-cause-link">
                                Follows {entry.cause.phrase} ({entry.cause.year})
                              </a>
                            ) : (
                              <>
                                Follows {entry.cause.phrase} ({entry.cause.year})
                              </>
                            )}
                          </div>
                        )}

                        {ghostNote && <div className="cw-ghost-note">{ghostNote}</div>}
                      </>
                    )}
                  </div>
                </li>
              );
            })}

            {/* Phase C/D: ghost year placeholders for unwritten years, then each streamed entry
                inked in as its tick arrives — never a wait-then-swap. */}
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
                  // Keyed distinctly from `data.entries`' own keys below (`stream-` prefix): once
                  // the rewrite settles, the final chronicle re-uses these same entry ids, and a
                  // shared key across the two sibling lists confused React's reconciliation into
                  // leaving this stale provisional line in the DOM instead of replacing it — a
                  // real bug caught live (screenshotting phase D still showed the italicized
                  // placeholder text instead of the finished, fully-narrated entry).
                  <li key={`stream-${s.id}`} className="cw-event cw-newborn" style={{ animationDelay: `${si * 80}ms` }}>
                    <div className="cw-year">{s.year}</div>
                    <div className="cw-event-content">
                      <p className="cw-event-text" style={{ fontStyle: "italic" }}>
                        {s.title}
                      </p>
                    </div>
                  </li>
                ))}
              </>
            )}
          </ol>

          {isDead && (
            <section className="cw-timeline" style={{ paddingTop: 0, textAlign: "center" }}>
              <div className="font-label text-ll-sun-ink" style={{ margin: "0 auto 18px", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase" }}>
                <SunEmblem className="h-3.5 w-3.5" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true" />
                End of life
              </div>
              {data.epilogue.length > 0 && (
                <div style={{ maxWidth: 620, margin: "0 auto 24px", textAlign: "left" }}>
                  <div className="cw-rail-label" style={{ marginBottom: 8 }}>
                    After {afterDeathPronoun} death
                  </div>
                  {data.epilogue.map((line, i) => (
                    <p key={i} className="cw-event-text" style={{ marginBottom: 8 }}>
                      <EntryProse prose={line} links={data.summaryLinks} onOpenPerson={setOpenPersonId} />
                    </p>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
                <button type="button" className="cw-turn-link" onClick={reopenLastTurn}>
                  Change an earlier moment
                </button>
                <button type="button" className="cw-turn-link" onClick={() => router.push("/")}>
                  Begin a new life
                </button>
              </div>
            </section>
          )}
        </article>

        <aside className="cw-right">
          <div className="cw-rail-label">This history</div>
          <div className="cw-branch-box">
            <div className="cw-branch-name">{currentBranch?.label ?? "Original life"}</div>
            <div className="cw-branch-list">
              {data.branches.map((b) => (
                <button
                  key={b.branchId}
                  type="button"
                  className={`cw-branch-item${b.branchId === data.branchId ? " cw-active" : ""}`}
                  onClick={() => switchBranch(b.branchId)}
                >
                  {b.label}
                  {b.forkYear ? ` (${b.forkYear})` : ""}
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
            Rewriting {p.name.split(" ")[0]}&apos;s life from {rewrite.divergenceYear}&hellip; now at {rewrite.tickYear}
          </span>
        </div>
      )}

      <AnimatePresence>
        {openEntry && <ChangeModal entry={openEntry} personSex={p.sex} onClose={() => setOpenEntry(null)} onChoose={applyChoice} busy={!!rewrite} />}
      </AnimatePresence>

      <AnimatePresence>
        {historyOpen && (
          <HistoryDrawer lifeId={data.lifeId} branches={data.branches} onClose={() => setHistoryOpen(false)} onNavigate={switchBranch} />
        )}
        {openPersonId && <PersonSheet key={openPersonId} lifeId={data.lifeId} branchId={data.branchId} personId={openPersonId} onClose={() => setOpenPersonId(null)} />}
      </AnimatePresence>
    </div>
  );
}

function EntryProse({ prose, links, onOpenPerson }: { prose: string; links: ChronicleData["summaryLinks"]; onOpenPerson: (personId: string) => void }) {
  const parts = parseProseMarkers(prose, links);
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : (
          <a
            key={i}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onOpenPerson(part.personId);
            }}
          >
            {part.name}
          </a>
        ),
      )}
    </>
  );
}

function HistoryDrawer({ branches, onClose, onNavigate }: { lifeId: string; branches: ChronicleData["branches"]; onClose: () => void; onNavigate: (branchId: string) => void }) {
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="cw-drawer-backdrop" onClick={onClose} />
      <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ duration: 0.25, ease: "easeOut" }} className="cw-drawer-panel">
        <div className="cw-modal-kicker">History</div>
        <h2>This history</h2>
        {branches.map((b) => (
          <button
            key={b.branchId}
            type="button"
            className="cw-drawer-person"
            style={{ display: "block", width: "100%" }}
            onClick={() => {
              onNavigate(b.branchId);
              onClose();
            }}
          >
            {b.label}
            {b.forkYear ? <small>Changed in {b.forkYear}</small> : <small>The life that was first simulated.</small>}
          </button>
        ))}
      </motion.div>
    </>
  );
}
