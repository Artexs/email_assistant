// The public changelog page (plan D12, P2): built from `parseChangelog` only, never from the raw file.
// It shows each release with its version and date, and the "For users" items in English.
// `Unreleased`, the file header, comments and every other group (operator text) are not published.
// A file that does not parse throws `ChangelogError`: the build fails.
import { parseChangelog, UNRELEASED } from "@ea/core";

export function changelogPage(markdown: string): string {
  const lines = ["# Changelog", ""];
  for (const release of parseChangelog(markdown)) {
    if (release.version === UNRELEASED) continue;
    lines.push(`## ${release.version} - ${release.date}`, "");
    if (release.forUsers.length > 0) {
      for (const item of release.forUsers) lines.push(`- ${item.en}`);
      lines.push("");
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}
