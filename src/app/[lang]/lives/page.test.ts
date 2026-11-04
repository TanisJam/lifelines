import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ lang: "en", lives: [] as unknown[], calls: 0 }));
vi.mock("next/navigation", () => ({ useParams: () => ({ lang: state.lang }) }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => [state.calls++ % 2 === 0 ? state.lives : initial, () => {}] };
});
import LivesPage from "./page";

describe("lives action", () => {
  it.each([["en", "Write their life"], ["es", "Escribir su vida"]])("offers a first life when empty in %s", (lang, label) => {
    state.lang = lang;
    state.calls = 0;
    state.lives = [];
    expect(renderToStaticMarkup(createElement(LivesPage))).toContain(label);
  });
  it.each([["en", "Write another life"], ["es", "Escribir otra vida"]])("keeps the another-life action when populated in %s", (lang, label) => {
    state.lang = lang;
    state.calls = 0;
    state.lives = [{ lifeId: "one", name: "One", birthYear: 1200, deathYear: null }];
    expect(renderToStaticMarkup(createElement(LivesPage))).toContain(label);
  });
});
