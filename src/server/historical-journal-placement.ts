/**
 * Places every entry in complete, strictly year-ordered journal records at
 * `year + (i + 1) / (n + 1)`, where i is its zero-based ordinal and n counts
 * all entries, including hidden and ineligible ones. Runtime cumulative
 * positions, people and prose are irrelevant; visible-only journals change slots.
 *
 * This is chronology math, not a calendar or a default timeline policy. Negative,
 * zero and gapped years are valid; empty journals and empty years are valid.
 * Years must be finite safe integers other than negative zero. IDs must be exact
 * nonempty JavaScript strings, unique across the entire journal, without trimming
 * or normalization. Arbitrary string keys are preserved as own properties.
 *
 * Throws on invalid years/IDs/order or floating-point precision collapse: every
 * placement must be finite, strictly inside its year and strictly increasing.
 * No rounding repair or fallback is applied, even for hidden entries.
 *
 * Accepts typed trusted journal snapshots structurally, not unknown objects or
 * hostile Proxy/getter inputs; this is not runtime admission or a security sandbox.
 * Does not mutate or retain input. Returns a detached, frozen null-prototype
 * dictionary of primitive numbers, so the result is deeply immutable.
 */
export function journalPlacements(
  journal: readonly {
    readonly plan: { readonly year: number };
    readonly entries: readonly { readonly id: string }[];
  }[],
): Readonly<Record<string, number>> {
  const placements: Record<string, number> = Object.create(null);
  let previousYear = -Infinity;
  for (const { plan, entries } of journal) {
    const year = plan.year;
    if (!Number.isSafeInteger(year) || Object.is(year, -0) || year <= previousYear) {
      throw new Error("Invalid or unordered journal year");
    }
    previousYear = year;
    let previousAt = year;
    for (let i = 0; i < entries.length; i++) {
      const id = entries[i].id;
      if (typeof id !== "string" || id.length === 0) throw new Error("Invalid journal ID");
      if (Object.hasOwn(placements, id)) throw new Error("Duplicate journal ID");
      const at = year + (i + 1) / (entries.length + 1);
      if (!Number.isFinite(at) || !(year < at && at < year + 1 && previousAt < at)) {
        throw new Error("Journal placement precision collapse");
      }
      placements[id] = at;
      previousAt = at;
    }
  }
  return Object.freeze(placements);
}
