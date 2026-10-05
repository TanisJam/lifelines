import type { Distribution } from "./decisions";

export function biologyDistribution(kind: string, p: number): Distribution {
  if (kind === "illness") return { illness: p, healthy: 1 - p };
  if (kind === "death") return { die: p, survive: 1 - p };
  if (kind === "return") return { return: p, stay: 1 - p };
  if (kind === "arranged-match") return { arrange: p, "no-match": 1 - p };
  // Decision 058: pre-existing bug found while adding the levy class multiplier — "levy" (options
  // `["impose", "spare"]`) fell through to this function's `arrive`/`no-arrival` default (meant for
  // "immigration"/"away-arrival", which happen to share the "arrive" label by coincidence), so
  // `sampleGumbelMax` could never actually choose `"impose"` and the death-resolution loop's
  // `if (record.chosen === "impose")` check was permanently unreachable — the lord's levy has never
  // fired an event since it was introduced (decision 035). Fixed here rather than filed as a
  // separate follow-up, since 058's own levy class-multiplier/Lay Subsidy work is otherwise inert.
  if (kind === "levy") return { impose: p, spare: 1 - p };
  return { arrive: p, "no-arrival": 1 - p };
}
