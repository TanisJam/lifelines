import type { LifeScene, SceneEdge, ScenePerson, VillageSoul } from "@/contracts/life";
import { ARRIVE, ARRIVE_LEAD, GROW, GROW_LEAD, GROW_PARENT, LET_GO } from "./constants";
import { clamp01 } from "./motion";

export const alive = (p: Pick<ScenePerson, "diedAt">, t: number): boolean => p.diedAt === undefined || p.diedAt > t;

/** A bond with `fromAt: null` predates the life, so it is active from the start. `untilAt` is exclusive. */
export const edgeActive = (e: SceneEdge, t: number): boolean => (e.fromAt === null || e.fromAt <= t) && (e.untilAt === undefined || e.untilAt > t);

/** Arrival progress 0..1: people present at the start are simply there; others fly in around `appearsAt`. */
export const presence = (p: ScenePerson, t: number, start: number): number => (p.appearsAt <= start ? 1 : clamp01((t - (p.appearsAt - ARRIVE_LEAD)) / ARRIVE));

export const growth = (e: SceneEdge, t: number): number => (e.fromAt === null ? 1 : clamp01((t - (e.fromAt - GROW_LEAD)) / (e.kind === "parent" ? GROW_PARENT : GROW)));

/** A dropped bond becomes a former one, dimming by 45% over LET_GO years. */
export const formerOpacity = (e: SceneEdge, t: number): number => (e.untilAt !== undefined && t > e.untilAt ? 1 - 0.45 * clamp01((t - e.untilAt) / LET_GO) : 1);

const FAMILY: ReadonlySet<ScenePerson["group"]> = new Set(["self", "parents", "siblings", "children"]);

/** The story circle: family always; anyone else only while an active spouse, lover or rival edge ties them to the protagonist. */
export function inCircle(scene: LifeScene, p: ScenePerson, t: number): boolean {
  if (FAMILY.has(p.group)) return true;
  const self = scene.people.find((q) => q.group === "self")?.id;
  return scene.edges.some((e) => (e.kind === "spouse" || e.kind === "lover" || e.kind === "rival") && ((e.a === self && e.b === p.id) || (e.b === self && e.a === p.id)) && edgeActive(e, t));
}

export const soulsAlive = (village: readonly VillageSoul[], t: number): number => village.filter((v) => v.b <= t && (v.d === undefined || v.d > t)).length;

/** Living, fully arrived members of the circle other than the protagonist. */
export function circleCount(scene: LifeScene, t: number): number {
  return scene.people.filter((p) => p.group !== "self" && presence(p, t, scene.span.start) >= 1 && inCircle(scene, p, t) && alive(p, t)).length;
}
