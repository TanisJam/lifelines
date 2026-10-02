import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureChronicle } from "@/lib/fixtures";
import { en } from "@/i18n/dictionaries/en";
import { applyDisabled, chosenOption, whyQuestion, type TurnEntry } from "./change-rules";
import { ChangeModal } from "./change-modal";

const entry = fixtureChronicle("life-elin").entries.find((e) => e.turn)! as TurnEntry;
const turn = entry.turn;
const open = { selected: "opt-b", busy: false, turnstileSiteKey: null, turnstileToken: null };

describe("Apply gate", () => {
  it("is disabled until an alternative is selected", () => {
    expect(applyDisabled({ ...open, selected: null })).toBe(true);
    expect(applyDisabled(open)).toBe(false);
  });

  it("is disabled while a rewrite runs", () => {
    expect(applyDisabled({ ...open, busy: true })).toBe(true);
  });

  it("with a site key it also needs a Turnstile token", () => {
    expect(applyDisabled({ ...open, turnstileSiteKey: "site" })).toBe(true);
    expect(applyDisabled({ ...open, turnstileSiteKey: "site", turnstileToken: "tok" })).toBe(false);
  });

  it("hands the selected option id to onChoose, and nothing while disabled", () => {
    expect(chosenOption(open)).toBe("opt-b");
    expect(chosenOption({ ...open, selected: null })).toBeNull();
    expect(chosenOption({ ...open, turnstileSiteKey: "site" })).toBeNull();
  });
});

describe("whyQuestion", () => {
  it("asks about chance, the protagonist, or the named decider", () => {
    expect(whyQuestion({ ...turn, deciderId: "chance" }, "f", en)).toBe(en.chronicle.modal.whyChance);
    expect(whyQuestion({ ...turn, deciderId: "self" }, "f", en)).toBe(en.chronicle.modal.whySelf("f"));
    expect(whyQuestion({ ...turn, deciderId: "npc-1", decidedBy: "Tomas Vell's choice" }, "f", en)).toBe(en.chronicle.modal.whyOther("Tomas Vell"));
  });
});

describe("ChangeModal markup", () => {
  const html = renderToStaticMarkup(createElement(ChangeModal, { entry, personSex: "f", dict: en, onClose: () => {}, onChoose: () => {}, busy: false, turnstileSiteKey: null, turnstileToken: null, onTurnstileToken: () => {} }));

  it("opens with Apply disabled and every alternative offered", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*class="sky-change-apply"|<button[^>]*class="sky-change-apply"[^>]*disabled=""/);
    for (const o of turn.alternatives) expect(html).toContain(o.label);
    expect(html).toContain(turn.chosen.label);
  });

  it("is night-scoped: no legacy cw- classes", () => {
    expect(html).not.toContain("cw-");
  });
});
