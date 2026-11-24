import { describe, expect, test } from "bun:test";

import { loadSections, orderSections } from "./sections";

describe("orderSections", () => {
  test("sorts by order, then by title", () => {
    const sorted = orderSections([
      { order: 2, title: "b" },
      { order: 1, title: "z" },
      { order: 2, title: "a" },
    ]);
    expect(sorted.map((section) => section.title)).toEqual(["z", "a", "b"]);
  });
});

describe("loadSections", () => {
  const render = () => null;

  test("gives each section the file name as its id and sorts them", () => {
    const sections = loadSections({
      "./sections/two.tsx": { section: { title: "Two", order: 2, render } },
      "./sections/one.tsx": { section: { title: "One", order: 1, render } },
    });
    expect(sections.map((section) => [section.id, section.title])).toEqual([
      ["one", "One"],
      ["two", "Two"],
    ]);
  });

  test("a module with no section export stops with the file name", () => {
    expect(() => loadSections({ "./sections/broken.tsx": { other: 1 } })).toThrow("no section export: broken.tsx");
  });
});
