import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/dictionaries/en";
import { initialRewrite, type Fork, type RewriteState } from "@/lib/sky/rewrite";
import { RewriteCard } from "./rewrite-card";

const fork: Fork = { entryId: "e1", year: 1504, at: 10, originalLabel: "Stayed", newLabel: "Left" };
const render = (state: RewriteState) => renderToStaticMarkup(createElement(RewriteCard, { state, firstName: "Elin", dict: en.chronicle }));
const at = (phase: RewriteState["phase"], over: Partial<RewriteState> = {}): RewriteState => ({ ...initialRewrite, phase, fork, ...over });

describe("RewriteCard", () => {
  it("renders nothing when idle without an error", () => {
    expect(render(initialRewrite)).toBe("");
  });

  it("idle with an error shows the alert", () => {
    expect(render({ ...initialRewrite, error: "nope" })).toContain('role="alert"');
  });

  it("D with an error (a failed branch load) shows the alert too", () => {
    const html = render(at("D", { error: "Couldn't load that branch." }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn&#x27;t load that branch.");
  });

  it("D without an error renders nothing", () => {
    expect(render(at("D"))).toBe("");
  });

  it("A shows the divergence", () => {
    const html = render(at("A"));
    expect(html).toContain("Stayed");
    expect(html).toContain("Left");
  });

  it("B and C say the life is being rewritten", () => {
    expect(render(at("B"))).toContain("1504");
    expect(render(at("C"))).toContain("1504");
  });
});
