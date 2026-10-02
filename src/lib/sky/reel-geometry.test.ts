import { describe, expect, it } from "vitest";
import { A_NOW, GAP, R_COMPASS } from "./constants";
import { arcPlace, entryLook, inReelZone, reelGeo, toldStrength, yNow } from "./reel-geometry";

const area = { left: 100, top: 50, width: 1200, height: 700 };
const disc = { left: 340, top: 100, width: 600, height: 600 };
const geo = reelGeo(area, disc);

describe("reelGeo", () => {
  it("centres the arc on the disc, in area coordinates, with the compass-plus-margin radius", () => {
    expect(geo.unit).toBeCloseTo(600 / 800, 9);
    expect(geo.cx).toBeCloseTo(240 + 300, 9);
    expect(geo.cy).toBeCloseTo(50 + 300, 9);
    expect(geo.ra).toBeCloseTo((R_COMPASS + 72) * geo.unit, 9);
    expect(geo.right).toBe(1200 - 160);
  });
});

describe("arcPlace", () => {
  it("puts the entry being told on the arc at the present angle", () => {
    const p = arcPlace(geo, 0)!;
    const a = (A_NOW * Math.PI) / 180;
    expect(p.x).toBeCloseTo(geo.cx + geo.ra * Math.cos(a), 6);
    expect(p.y).toBeCloseTo(geo.cy + geo.ra * Math.sin(a), 6);
  });

  it("moves entries down the arc as they age and hides those beyond the arc", () => {
    expect(arcPlace(geo, 200)!.y).toBeGreaterThan(arcPlace(geo, 0)!.y);
    expect(arcPlace(geo, 1e6)).toBeNull();
    expect(arcPlace(geo, -1e6)).toBeNull();
  });

  it("agrees with yNow: y = 0 sits at the present", () => {
    expect(yNow(geo)).toBeCloseTo(geo.ra * Math.sin((A_NOW * Math.PI) / 180), 9);
  });
});

describe("entryLook", () => {
  it("fades future entries in as they approach and keeps their node dim", () => {
    const far = entryLook(-GAP * 3, true);
    const near = entryLook(-GAP * 0.2, true);
    expect(far.opacity).toBe(0);
    expect(near.opacity).toBeGreaterThan(0.8);
    expect(near.node).toBe(0.45);
  });

  it("holds past entries solid near the present and fades them into deeper time", () => {
    expect(entryLook(0, false)).toEqual({ opacity: 1, node: 1 });
    expect(entryLook(GAP * 3, false).opacity).toBeGreaterThan(0);
    expect(entryLook(GAP * 6, false).opacity).toBe(0);
  });
});

describe("toldStrength", () => {
  it("is full for the told entry at the present once its first moments have passed", () => {
    expect(toldStrength(0, 1510.5, 1510)).toBe(1);
  });

  it("builds up over the first 0.12 years, and lets go as the entry slides away", () => {
    expect(toldStrength(0, 1510.06, 1510)).toBeCloseTo(0.5, 9);
    expect(toldStrength(GAP * 2, 1512, 1510)).toBe(0);
  });
});

describe("inReelZone", () => {
  const stage = { left: 100, top: 50, right: 1300, bottom: 750 };
  const ring = { x: 640, y: 400 };
  const r = 300;

  it("accepts any point right of the compass ring inside the stage, gaps between rows included", () => {
    expect(inReelZone(1000, 120, ring, r, stage)).toBe(true);
    expect(inReelZone(1000, 700, ring, r, stage)).toBe(true);
    expect(inReelZone(ring.x + r, 400, ring, r, stage)).toBe(true);
  });

  it("rejects points over the sky, outside the stage, or left of the ring", () => {
    expect(inReelZone(ring.x + r - 1, 400, ring, r, stage)).toBe(false);
    expect(inReelZone(400, 400, ring, r, stage)).toBe(false);
    expect(inReelZone(1400, 400, ring, r, stage)).toBe(false);
    expect(inReelZone(1000, 800, ring, r, stage)).toBe(false);
    expect(inReelZone(1000, 10, ring, r, stage)).toBe(false);
  });
});
