import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ lang: "es", lifeId: "life-1" }),
  useSearchParams: () => new URLSearchParams("branch=child%2Fone"),
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => [initial, vi.fn()], useEffect: (effect: () => unknown) => { state.effects.push(effect); } };
});
vi.mock("@/components/sky/sky-view", () => ({ SkyView: () => null }));
vi.mock("@/lib/life-client", () => ({ getChronicle: vi.fn(async () => ({})) }));
vi.mock("@/i18n/get-dictionary", () => ({ getDictionary: () => ({ life: { loadError: "load error", opening: "opening" } }) }));

import LifePage from "./page";
import { getChronicle } from "@/lib/life-client";

describe("LifePage branch selection", () => {
  it("passes the page query branch through to the chronicle client", async () => {
    state.effects.length = 0;
    const loader = LifePage();
    expect(loader.props.initialBranchId).toBe("child/one");
    loader.type(loader.props);
    expect(state.effects).toHaveLength(1);
    state.effects[0]!();
    await vi.waitFor(() => expect(getChronicle).toHaveBeenCalledWith("life-1", "child/one", "es"));
  });
});
