import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureChronicle } from "@/lib/fixtures";
import { en } from "@/i18n/dictionaries/en";
import { SkyView } from "./sky-view";

const markup = renderToStaticMarkup(createElement(SkyView, { chronicle: fixtureChronicle("life-elin"), dict: en, lang: "en" }));

/**
 * The left edge of the sky is one column: the intro and the place are siblings inside `.sky-left`, in that order.
 * That is what keeps a rewritten life's extra lines ("Changed in YYYY" and the history switcher) from being drawn
 * over the village name — both used to be pinned to the same edge with `position: absolute`, so a taller intro
 * simply ran into the place panel (regression: overlapping text after a rewrite).
 */
describe("The left edge of the sky", () => {
  it("stacks the intro and the place inside one column", () => {
    const column = markup.indexOf('class="sky-left"');
    const intro = markup.indexOf('class="sky-intro"');
    const place = markup.indexOf('class="sky-place"');
    expect(column).toBeGreaterThan(-1);
    expect(intro).toBeGreaterThan(column);
    expect(place).toBeGreaterThan(intro);
  });

  it("links back to the reader's lives", () => {
    expect(markup).toContain('class="sky-back" href="/en/lives"');
  });
});
