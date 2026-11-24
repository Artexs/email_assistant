/// <reference types="bun" />
import { categories } from "@ea/core";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CategoryPill } from "../components/patterns/CategoryPill";
import { categoryLook } from "./category-look";

describe("CategoryPill", () => {
  test.each(categories)("%s shows its label, an icon and its tone", (category) => {
    const html = renderToStaticMarkup(<CategoryPill category={category} label="Label text" />);
    expect(html).toContain(">Label text</span>");
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
    for (const name of categoryLook[category].tone.split(" ")) expect(html).toContain(name);
  });
});
