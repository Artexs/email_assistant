/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { isPlainClick, PillNav } from "../components/delegation/PillNav";

describe("PillNav", () => {
  test("a nav with the given name; only the current item has aria-current", () => {
    const html = renderToStaticMarkup(
      <PillNav
        label="Pages"
        current="b"
        items={[
          { key: "a", href: "/a", label: "Alpha" },
          { key: "b", href: "/b", label: "Beta" },
        ]}
      />
    );
    expect(html).toContain('<nav aria-label="Pages"');
    expect(html).toMatch(/<a href="\/a"(?![^>]*aria-current)[^>]*>Alpha<\/a>/);
    expect(html).toMatch(/<a href="\/b" aria-current="page"[^>]*>Beta<\/a>/);
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });
});

describe("isPlainClick", () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  test.each([
    ["a left click with no modifier", {}, true],
    ["ctrl", { ctrlKey: true }, false],
    ["meta", { metaKey: true }, false],
    ["shift", { shiftKey: true }, false],
    ["alt", { altKey: true }, false],
    ["a middle click", { button: 1 }, false],
  ])("%s", (_name, patch, expected) => {
    expect(isPlainClick({ ...base, ...patch })).toBe(expected);
  });
});
