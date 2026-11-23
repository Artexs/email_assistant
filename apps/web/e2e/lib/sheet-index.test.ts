import { describe, expect, test } from "bun:test";

import { sheetIndexHtml, type SheetEntry } from "./sheet-index";

const entry = (over: Partial<SheetEntry>): SheetEntry => ({
  state: "main",
  name: "settings",
  viewport: "phone",
  scheme: "light",
  locale: "en",
  file: "main/settings-phone-light-en.png",
  overflow: false,
  ...over,
});

describe("sheetIndexHtml", () => {
  test("two entries of one route give one section with the pictures in a fixed order", () => {
    const html = sheetIndexHtml([
      entry({ viewport: "desktop", file: "main/settings-desktop-light-en.png" }),
      entry({}),
    ]);
    expect(html.match(/<section>/g)).toHaveLength(1);
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html.indexOf("settings-phone-light-en.png")).toBeLessThan(html.indexOf("settings-desktop-light-en.png"));
  });

  test("an entry with overflow carries the text and a clean one does not", () => {
    expect(sheetIndexHtml([entry({ overflow: true })])).toContain("overflow at 320 px");
    expect(sheetIndexHtml([entry({})])).not.toContain("overflow at 320 px");
  });

  test("a name with a tag is escaped", () => {
    const html = sheetIndexHtml([entry({ name: "<b>x</b>", file: "main/<b>.png" })]);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  test("the page has no script and no remote asset", () => {
    const html = sheetIndexHtml([entry({})]);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http");
  });
});
