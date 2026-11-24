import { compile } from "@tailwindcss/node";
import { categories } from "@ea/core";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { categoryLook } from "./category-look";

const stylesDir = join(import.meta.dir, "../styles");

// The CSS that the real stylesheet and the real Tailwind compiler build for these class names.
async function buildCss(classes: string[]): Promise<string> {
  const compiler = await compile(readFileSync(join(stylesDir, "global.css"), "utf8"), {
    base: stylesDir,
    onDependency: () => undefined,
  });
  return compiler.build(classes);
}

describe("categoryLook", () => {
  test("has one row for each value of the category enum", () => {
    expect(Object.keys(categoryLook).sort()).toEqual([...categories].sort());
  });

  test("every tone class is in the built CSS", async () => {
    const classes = Object.values(categoryLook).flatMap((look) => look.tone.split(" "));
    const built = await buildCss(classes);
    const missing = classes.filter((name) => !built.includes(`.${name}`));
    expect(missing).toEqual([]);
    expect(classes).toHaveLength(categories.length * 2);
  });

  test("the built CSS leaves out a class that has no token", async () => {
    expect((await buildCss(["bg-cat-nonexistent-soft"])).includes(".bg-cat-nonexistent-soft")).toBe(false);
  });
});
