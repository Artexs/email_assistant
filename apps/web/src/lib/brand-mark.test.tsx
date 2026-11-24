/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { BrandMark } from "../components/shell/BrandMark";

const web = join(import.meta.dir, "../..");

// The first `:root` block holds the light tokens.
function lightToken(name: string): string {
  const css = readFileSync(join(web, "src/styles/global.css"), "utf8");
  const light = css.slice(css.indexOf(":root"), css.indexOf("@media (prefers-color-scheme: dark)"));
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(light)?.[1];
  if (value === undefined) throw new Error(`global.css has no light token --${name}`);
  return value;
}

describe("BrandMark", () => {
  test("the root hides itself from a reader: the brand name next to it is the text", () => {
    expect(renderToStaticMarkup(<BrandMark />)).toMatch(/^<span aria-hidden="true" /);
  });

  test("size lg is the 48 px tile", () => {
    const html = renderToStaticMarkup(<BrandMark size="lg" />);
    expect(html).toContain("size-12");
    expect(html).not.toContain("size-9");
  });

  test("tone inverse swaps the two colours of the primary tone", () => {
    expect(renderToStaticMarkup(<BrandMark tone="inverse" />)).toContain("bg-primary-foreground text-primary");
    expect(renderToStaticMarkup(<BrandMark />)).toContain("bg-primary text-primary-foreground");
  });
});

describe("brand/mark.svg", () => {
  test("its two colours are the light primary and the light primary foreground", () => {
    const svg = readFileSync(join(web, "brand/mark.svg"), "utf8");
    const colours = [...new Set([...svg.matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]))].sort();
    expect(colours).toEqual([lightToken("primary"), lightToken("primary-foreground")].sort());
  });
});
