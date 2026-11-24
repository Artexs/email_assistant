/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StickyActions } from "../components/patterns/StickyActions";

describe("StickyActions", () => {
  test("renders its children once and one spacer", () => {
    const html = renderToStaticMarkup(
      <StickyActions>
        <button type="button">Approve</button>
      </StickyActions>
    );
    expect(html.match(/Approve/g)).toHaveLength(1);
    expect(html.match(/data-slot="sticky-actions-spacer"/g)).toHaveLength(1);
  });

  test("below lg the bar sits above the tab bar and its safe-area inset", () => {
    const html = renderToStaticMarkup(<StickyActions>x</StickyActions>);
    expect(html).toContain("fixed");
    expect(html).toContain("bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom))]");
    expect(html).toContain("lg:static");
    expect(html).not.toContain("style=");
  });
});
