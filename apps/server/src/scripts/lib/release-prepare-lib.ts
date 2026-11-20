/** Pure parts of `bun run release:prepare <x.y.z>`: version rules, the changelog move, the package.json stamp. */

export const releasePrepareUsage = "usage: bun run release:prepare <x.y.z> [--date YYYY-MM-DD] [--root <folder>]";

const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const unreleasedHeading = "## [Unreleased]";

export type PrepareResult = { ok: true; changelog: string; packageJson: string } | { ok: false; reason: string };

function parts(version: string): [number, number, number] | null {
  const match = versionPattern.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True when `next` is a higher version than `current`. Both must be `x.y.z`. */
export function isGreaterVersion(next: string, current: string): boolean {
  const a = parts(next);
  const b = parts(current);
  if (a === null || b === null) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

export function readPackageVersion(packageJson: string): string | null {
  return /^ {2}"version":\s*"([^"]+)"/m.exec(packageJson)?.[1] ?? null;
}

/** The items of one changelog section: groups without an item are dropped. Returns null when no item is left. */
function releasedBody(section: string[]): string | null {
  const out: string[] = [];
  let heading: string | null = null;
  let items = 0;
  for (const line of section) {
    if (line.trim() === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    } else if (line.startsWith("### ")) {
      heading = line;
    } else {
      if (heading !== null) {
        if (out.length > 0 && out[out.length - 1] !== "") out.push("");
        out.push(heading, "");
        heading = null;
      }
      out.push(line);
      items += 1;
    }
  }
  if (items === 0) return null;
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/**
 * Moves the items under `## [Unreleased]` to `## [<version>] - <date>`, leaves an empty `## [Unreleased]`
 * and sets `version` in package.json. Refuses (no output text) on a bad version, a version that is not
 * greater, a missing Unreleased heading or an empty Unreleased.
 */
export function prepareRelease(input: {
  version: string;
  date: string;
  changelog: string;
  packageJson: string;
}): PrepareResult {
  const { version, date, changelog, packageJson } = input;
  if (parts(version) === null) return { ok: false, reason: `"${version}" is not x.y.z` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: `"${date}" is not YYYY-MM-DD` };
  const current = readPackageVersion(packageJson);
  if (current === null || parts(current) === null) return { ok: false, reason: "package.json has no version x.y.z" };
  if (!isGreaterVersion(version, current))
    return { ok: false, reason: `${version} is not greater than the current version ${current}` };

  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === unreleasedHeading);
  if (start === -1) return { ok: false, reason: `CHANGELOG.md has no "${unreleasedHeading}" heading` };
  let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  if (end === -1) end = lines.length;
  const body = releasedBody(lines.slice(start + 1, end));
  if (body === null) return { ok: false, reason: "Unreleased has no item" };

  const rest = lines.slice(end);
  const next = [
    ...lines.slice(0, start),
    unreleasedHeading,
    "",
    `## [${version}] - ${date}`,
    "",
    ...body.split("\n"),
    "",
  ];
  if (rest.length > 0) next.push(...rest);
  else next.pop();
  const stamped = packageJson.replace(/^( {2}"version":\s*")[^"]+(")/m, `$1${version}$2`);
  return { ok: true, changelog: `${next.join("\n").replace(/\n+$/, "")}\n`, packageJson: stamped };
}

/** The next commands for the operator. */
export function nextCommands(version: string): string[] {
  return [
    "git add package.json CHANGELOG.md",
    `git commit -m "Release v${version}"`,
    "git push",
    "# wait for green CI on that commit (docs/release-checklist.md)",
    `git tag -a v${version} -m "v${version}"`,
    `git push origin v${version}`,
  ];
}
