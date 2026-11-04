import type { LifeStreamEvent } from "@/contracts/life";
import { buildGhostAnnotations } from "@/domain/decision-id";
import type { LifecycleChoiceDeclaration } from "@/domain/e-lifecycle-choice";
import { forkLifecycle, type LifecycleForkLineage } from "@/domain/e-lifecycle-fork";
import { createLifecycleForkCapsule, type LifecycleForkCapsule } from "@/domain/e-lifecycle-fork-capsule";
import type { Locale } from "@/domain/locale";
import { LifecycleBranchStore } from "./lifecycle-branch-store";
import { projectLifecycleChronicle, projectLifecycleTick, type LifecycleProjectionSource } from "./lifecycle-projection";
import { buildLifecycleChronicle } from "./lifecycle-read";

type Fork = Awaited<ReturnType<typeof forkLifecycle>>;
type Parent = LifecycleProjectionSource & { readonly lineage?: LifecycleForkLineage };

/** Project an admitted parent and publish its rewrite. The caller owns admission and transport. */
export async function streamLifecycleRewrite(input: {
  readonly lifeId: string;
  readonly branchId: string;
  readonly parent: Parent;
  readonly parentCapsule?: LifecycleForkCapsule;
  readonly choice: LifecycleChoiceDeclaration;
  readonly locale: Locale;
  readonly signal: AbortSignal;
  readonly store: LifecycleBranchStore;
  readonly send: (event: LifeStreamEvent) => void | Promise<void>;
}): Promise<void> {
  const { lifeId, branchId, parent, choice, locale, signal, store, send } = input;
  if (signal.aborted) return;
  const target = parent.output.owned.decisions.find(decision => decision.id === choice.decisionId);
  if (!target) throw new Error("Lifecycle choice target not found");
  const protagonist = parent.output.owned.people[parent.output.protagonistId];
  if (!protagonist) throw new Error("Lifecycle protagonist not found");
  const option = target.options.find(item => item.id === choice.optionId);
  if (!option) throw new Error("Lifecycle choice option not found");
  await send({ type: "start", lifeId, branchId, villageName: parent.genesis.initial.config.town.name,
    protagonist: { name: protagonist.name, sex: protagonist.sex, birthYear: protagonist.birthYear } });
  if (signal.aborted) return;
  await send({ type: "divergence", entryId: target.resultingEventIds[0] ?? target.id, year: target.year,
    originalLabel: target.options.find(item => item.id === target.chosen)?.label ?? target.chosen, newLabel: option.label });
  if (signal.aborted) return;
  let child: Fork;
  try { child = await forkLifecycle(parent, choice, { signal }); }
  catch (error) { if (signal.aborted) return; throw error; }
  const source = { genesis: child.genesis, output: child.output } as unknown as LifecycleProjectionSource;
  const forkYear = child.lineage.forkYear;
  for (const record of child.output.journal) {
    if (record.year < forkYear) continue;
    if (signal.aborted) return;
    const tick = await projectLifecycleTick({ source, year: record.year, locale });
    if (signal.aborted) return;
    await send({ type: "tick", ...tick.view });
  }
  if (signal.aborted) return;
  const projected = await projectLifecycleChronicle({ source, identity: { lifeId, branchId }, locale });
  const ghosts = buildGhostAnnotations(parent.output.owned.decisions,
    child.output.owned.decisions.filter(decision => decision.year >= forkYear),
    projected.view.entries.filter(entry => (entry.endYear ?? entry.year) >= forkYear), forkYear);
  const capsule = await createLifecycleForkCapsule(child, input.parentCapsule ? { parent: input.parentCapsule } : {});
  if (signal.aborted) return;
  await store.publishFork({ lifeId, branchId, capsule });
  if (signal.aborted) return;
  const result = await buildLifecycleChronicle(lifeId, branchId, locale);
  if (signal.aborted) return;
  if (!result.data) throw new Error(result.error ?? "Failed to build lifecycle chronicle");
  await send({ type: "done", chronicle: result.data, ghosts, stats: { jevCalls: 0, cacheHits: 0, wallTimeMs: 0 } });
}
