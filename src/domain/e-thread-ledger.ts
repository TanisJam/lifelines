import type { HelpFavorEffect } from "./effects";
import type { RuntimeEntry } from "./e-runtime";

export interface HelpThread {
  id: string; obligation: string; actors: string[]; setup: string; openedYear: number;
  eligibleYear: number; status: "open" | "fulfilled" | "broken" | "dead";
  terminal?: string; terminalYear?: number;
}
export type ThreadBeat = {
  kind: "setup" | "payoff" | "death"; thread: string; source: string; year: number;
  actors: string[]; causes: string[]; effects?: HelpFavorEffect[]; selected?: "help" | "refuse";
};

/** Derive compact facts exclusively from operations already committed in this draft year. */
export function evolveThreadLedger(previous: readonly HelpThread[], entries: readonly RuntimeEntry[], protagonist: string,
  year: number, deaths: Readonly<Record<string, { year: number; id: string } | undefined>>): { threads: HelpThread[]; beats: ThreadBeat[] } {
  const threads = [...previous];
  const beats: ThreadBeat[] = [];
  for (const entry of entries) {
    if (entry.outcome !== "committed") continue;
    if (entry.kind === "grain-grant" && entry.actors.includes(protagonist)) {
      const effects = entry.effects as HelpFavorEffect[];
      const obligation = effects.find(effect => effect.kind === "obligation");
      const grain = effects.find(effect => effect.kind === "grain");
      if (!obligation || obligation.kind !== "obligation" || !grain || obligation.origin !== entry.id
        || obligation.creditor !== entry.actors[0] || obligation.debtor !== entry.actors[1]
        || threads.some(thread => thread.obligation === obligation.id)) continue;
      const thread: HelpThread = { id: `help/${obligation.id}`, obligation: obligation.id, actors: [...entry.actors],
        setup: entry.id, openedYear: entry.year, eligibleYear: entry.year + 3, status: "open" };
      threads.push(thread);
      beats.push({ kind: "setup", thread: thread.id, source: entry.id, year: entry.year,
        actors: [...entry.actors], causes: [...entry.causes], effects: structuredClone(effects) });
    } else if (entry.kind === "help-response" && entry.authority) {
      const effects = entry.effects as HelpFavorEffect[];
      const settlement = effects.find(effect => effect.kind === "settlement");
      if (!settlement || settlement.kind !== "settlement") continue;
      const index = threads.findIndex(thread => thread.status === "open" && thread.obligation === settlement.id
        && thread.setup === settlement.origin && entry.causes.includes(thread.setup)
        && thread.actors[0] === entry.actors[0] && thread.actors[1] === entry.actors[1]);
      if (index < 0) continue;
      const thread = threads[index];
      // A same-year death takes precedence over a response in the derived thread;
      // the committed response is not converted into a thread payoff.
      if (thread.actors.some(actor => deaths[actor] !== undefined && deaths[actor]!.year <= year)) continue;
      threads[index] = { ...thread, status: settlement.status, terminal: entry.id, terminalYear: entry.year };
      beats.push({ kind: "payoff", thread: thread.id, source: entry.id, year: entry.year,
        actors: [...entry.actors], causes: [...entry.causes], effects: structuredClone(effects), selected: entry.authority.selected });
    }
  }
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i];
    if (thread.status !== "open") continue;
    const dead = thread.actors.find(actor => deaths[actor] !== undefined && deaths[actor]!.year <= year);
    if (dead === undefined) continue;
    const death = deaths[dead]!;
    threads[i] = { ...thread, status: "dead", terminal: death.id, terminalYear: death.year };
    beats.push({ kind: "death", thread: thread.id, source: death.id, year: death.year, actors: [...thread.actors], causes: [] });
  }
  return { threads, beats };
}
