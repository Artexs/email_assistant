/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StatTile } from "../components/patterns/StatTile";

describe("StatTile", () => {
  test("shows the number in tabular figures with the label under it", () => {
    const html = renderToStaticMarkup(<StatTile value="1,284" label="mails handled" />);
    expect(html.indexOf(">1,284<")).toBeLessThan(html.indexOf(">mails handled<"));
    expect(html).toContain("tabular-nums");
  });
});
