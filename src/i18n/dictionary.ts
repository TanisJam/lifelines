import type { en } from "./dictionaries/en";

/** The shape every locale's dictionary must satisfy — inferred from the canonical English one, so `es.ts` gets a compile error the moment it's missing a key `en.ts` has (decision 059's "dictionary parity" guarantee). */
export type Dictionary = typeof en;
