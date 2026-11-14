import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const islandsDir = join(import.meta.dir, "../islands");
const pagesDir = join(import.meta.dir, "../pages");

const islandFiles = readdirSync(islandsDir).filter((file) => file.endsWith(".tsx"));
const pageFiles = readdirSync(pagesDir).filter((file) => file.endsWith(".astro"));

describe("islands", () => {
  test("there are islands to check", () => {
    expect(islandFiles.length).toBe(10);
  });

  test("every island starts its default export with useLocale()", () => {
    for (const file of islandFiles) {
      const source = readFileSync(join(islandsDir, file), "utf8");
      expect(source, file).toContain("export default function");
      const first = /export default function \w+\([^)]*\) \{\s*(?:\/\/[^\n]*\n\s*)*([^\n]*)/.exec(source)?.[1]?.trim();
      expect(first, file).toBe("useLocale();");
    }
  });

  test("every page that mounts an island renders it on the client only", () => {
    const mounting = pageFiles.filter((file) => readFileSync(join(pagesDir, file), "utf8").includes("../islands/"));
    expect(mounting.length).toBe(islandFiles.length);
    for (const file of mounting) {
      const source = readFileSync(join(pagesDir, file), "utf8");
      expect(source, file).toContain('client:only="react"');
      expect(source, file).not.toContain("client:load");
    }
  });
});
