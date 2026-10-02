/** Geometry and timing of the night sky, ported from docs/design/night-sky-mock.html. All radii are in the 800-unit SVG space. */
export const R1 = 150;
export const R2 = 248;
export const R_DIAL = 318;
export const R_PROGRESS = 345;
export const R_COMPASS = 372;

/** Simulated years per real second at 1x. */
export const RATE = 0.56;
/** Share of a travel spent braking to rest. */
export const SETTLE = 0.2;
/** Longest frame the clock will integrate, so a stalled tab does not leap. */
export const MAX_DT = 0.1;

export const ARRIVE_LEAD = 0.45;
export const ARRIVE = 1.2;
export const GROW_LEAD = 0.25;
export const GROW = 1.3;
export const GROW_PARENT = 0.9;
/** Years a dropped bond takes to dim. */
export const LET_GO = 1.0;

/** Reel tape: minimum pixels between entries, and pixels per simulated year. */
export const GAP = 128;
export const PX_PER_YEAR = 48;
/** Angle on the reel arc where entries are inked in. */
export const A_NOW = -26;

/** Inner-ring sector (degrees) owned by each relation group. */
export const SECTORS = { parents: [-118, -62], siblings: [-168, -128], spouses: [-26, 26], children: [40, 128], others: [140, 196] } as const;
/** Ring radius per group when it is not the inner ring. */
export const GROUP_RADIUS = { children: R1 + 12, others: R1 + 50 } as const;
/** Angular step (degrees) between outer-ring people hanging from the same child. */
export const OUTER_STEP = 11;
