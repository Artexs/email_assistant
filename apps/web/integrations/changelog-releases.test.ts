import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ChangelogError } from "@ea/core/web";

import changelogReleases, { CHANGELOG_URL, panelReleases, VIRTUAL_ID } from "./changelog-releases";

const GOOD = `# Changelog

## [Unreleased]

### For users

- en: Not yet.
  pl: Jeszcze nie.

## [0.2.0] - 2026-11-15

### For users

- en: One.
  pl: Jeden.

### Added

- Operator text.

## [0.1.0] - 2026-11-14

### Added

- Operator text only.
`;

describe("panelReleases", () => {
  test("keeps only released versions with For users lines, and no operator text or date", () => {
    expect(panelReleases(GOOD)).toEqual([{ version: "0.2.0", forUsers: [{ en: "One.", pl: "Jeden." }] }]);
    expect(JSON.stringify(panelReleases(GOOD))).not.toContain("Operator");
  });

  test("a file that does not parse throws, so the build stops", () => {
    expect(() => panelReleases("## [x] - 2026-01-01\n")).toThrow(ChangelogError);
    expect(() => panelReleases("## [0.1.0] - 2026-13-01\n")).toThrow(ChangelogError);
  });
});

interface VitePlugin {
  resolveId: (id: string) => string | null;
  load: (id: string) => string | null;
}

function setupPlugin(): VitePlugin {
  let plugin: VitePlugin | undefined;
  const hook = changelogReleases().hooks["astro:config:setup"] as unknown as (options: {
    updateConfig: (config: { vite: { plugins: VitePlugin[] } }) => void;
  }) => void;
  hook({ updateConfig: (config) => (plugin = config.vite.plugins[0]) });
  if (plugin === undefined) throw new Error("the integration added no Vite plugin");
  return plugin;
}

describe("changelogReleases integration", () => {
  test("it serves the virtual module from the real file", () => {
    const plugin = setupPlugin();
    const resolved = plugin.resolveId(VIRTUAL_ID);
    expect(resolved).toBe(`\0${VIRTUAL_ID}`);
    expect(plugin.resolveId("other")).toBeNull();
    const real = panelReleases(readFileSync(fileURLToPath(CHANGELOG_URL), "utf8"));
    expect(plugin.load(`\0${VIRTUAL_ID}`)).toBe(`export const RELEASES = ${JSON.stringify(real)};\n`);
    expect(plugin.load("other")).toBeNull();
  });

  test("no env or file switch picks another changelog", () => {
    const source = readFileSync(new URL("./changelog-releases.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env|Bun\.env|import\.meta\.env/);
  });
});

describe("the image", () => {
  test("T4 the Dockerfile copies CHANGELOG.md to /app before the web build", () => {
    const dockerfile = readFileSync(new URL("../../../deploy/Dockerfile", import.meta.url), "utf8");
    const copy = dockerfile.indexOf("\nCOPY CHANGELOG.md CHANGELOG.md\n");
    const build = dockerfile.indexOf("\nRUN bun run web:build\n");
    expect(copy).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(copy);
  });
});
