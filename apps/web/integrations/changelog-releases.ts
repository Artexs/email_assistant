// Astro integration: the panel's "What is new" card reads the released versions of `CHANGELOG.md` (F112 stage 15, plan P9, D13).
// The file is parsed at build time (`parseChangelog`); a file that does not parse stops the build. The island gets the module
// `virtual:ea-changelog-releases`: only the released versions that have "For users" lines, no raw Markdown.
// There is no env or file switch for another changelog: a test input in a production build would be a risk.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseChangelog, UNRELEASED } from "@ea/core/web";
import type { AstroIntegration } from "astro";

export interface PanelRelease {
  version: string;
  forUsers: { en: string; pl: string }[];
}

export const VIRTUAL_ID = "virtual:ea-changelog-releases";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** The released versions with at least one "For users" item, newest first. Throws `ChangelogError` on a bad file. */
export function panelReleases(markdown: string): PanelRelease[] {
  return parseChangelog(markdown)
    .filter((release) => release.version !== UNRELEASED && release.forUsers.length > 0)
    .map((release) => ({ version: release.version, forUsers: release.forUsers }));
}

export const CHANGELOG_URL = new URL("../../../CHANGELOG.md", import.meta.url);

export default function changelogReleases(): AstroIntegration {
  return {
    name: "ea-changelog-releases",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        const releases = panelReleases(readFileSync(fileURLToPath(CHANGELOG_URL), "utf8"));
        const source = `export const RELEASES = ${JSON.stringify(releases)};\n`;
        updateConfig({
          vite: {
            plugins: [
              {
                name: "ea-changelog-releases",
                resolveId: (id: string) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
                load: (id: string) => (id === RESOLVED_ID ? source : null),
              },
            ],
          },
        });
      },
    },
  };
}
