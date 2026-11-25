/// <reference types="bun" />
import { Inbox } from "lucide-react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState } from "../components/patterns/EmptyState";

describe("EmptyState", () => {
  test("renders the title as h2 and the buttons after the text", () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={Inbox} title="Nothing here" text="Add one.">
        <button type="button">Add</button>
      </EmptyState>
    );
    expect(html).toContain("<h2");
    expect(html).not.toContain("<h3");
    expect(html.indexOf("Add one.")).toBeGreaterThan(html.indexOf("Nothing here"));
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf("Add one."));
  });

  test.each([
    [2, "h2", true],
    [3, "h3", false],
  ] as const)("heading level %d renders an %s, in a card of its own: %p", (level, tag, inCard) => {
    const html = renderToStaticMarkup(<EmptyState icon={Inbox} title="Nothing here" headingLevel={level} />);
    expect(html.match(/<h[23]/g)).toEqual([`<${tag}`]);
    expect(html.includes('data-slot="card"')).toBe(inCard);
  });

  test("the blob is hidden from assistive technology", () => {
    const html = renderToStaticMarkup(<EmptyState icon={Inbox} title="Nothing here" />);
    expect(html).toContain('aria-hidden="true"');
  });
});
