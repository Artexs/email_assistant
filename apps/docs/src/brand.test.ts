import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The docs site shows the brand mark of the panel: the favicon and the header logo are copies of the one source file.
const SOURCE = join(import.meta.dirname, "../../web/brand/mark.svg");
const COPIES = ["public/favicon.svg", "src/assets/mark.svg"];

describe("the brand mark", () => {
  test.each(COPIES)("%s has the same bytes as the panel mark", (copy) => {
    const same = readFileSync(join(import.meta.dirname, "..", copy)).equals(readFileSync(SOURCE));
    expect(same ? "same" : `${copy} differs from apps/web/brand/mark.svg`).toBe("same");
  });

  test("the Starlight logo is the copy in src/assets", () => {
    const config = readFileSync(join(import.meta.dirname, "../astro.config.mjs"), "utf8");
    expect(config).toContain(`logo: { src: "./src/assets/mark.svg", alt: "", replacesTitle: false }`);
  });
});
