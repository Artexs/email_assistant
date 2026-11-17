// CHANGELOG.md parser (F112 stage 13, plan D12). Format: Keep a Changelog 1.1 as `release:prepare` writes it.
//   ## [x.y.z] - YYYY-MM-DD      plain SemVer, newest first; the first heading may be `## [Unreleased]`
//   ### For users                optional group: `- en: <text>`, next line `  pl: <text>`
// Every other `###` group is free operator text. HTML comments and link lines (`[x.y.z]: <url>`) are skipped.
// This file uses no Node module: the panel build and the docs build both import it.

export interface ChangelogRelease {
  /** `x.y.z`, or `Unreleased`. */
  version: string;
  /** `YYYY-MM-DD`, or null for `Unreleased`. */
  date: string | null;
  forUsers: { en: string; pl: string }[];
}

/** `message` is one of `changelog_heading`, `changelog_order`, `changelog_duplicate`, `changelog_date`, `changelog_for_users_item`. */
export class ChangelogError extends Error {
  constructor(
    message: string,
    readonly line: number
  ) {
    super(`${message} (line ${line})`);
    this.name = "ChangelogError";
  }
}

export const UNRELEASED = "Unreleased";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_HEADING = /^## \[([^\]]*)\] - (\S*)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LINK_LINE = /^\[[^\]]+\]:\s/;
const FOR_USERS_HEADING = "### For users";
const EN_ITEM = /^- en: (\S.*)$/;
const PL_ITEM = /^ {2}pl: (\S.*)$/;

function semverParts(version: string): [bigint, bigint, bigint] {
  const match = SEMVER.exec(version);
  if (match === null) throw new Error(`compare_semver ${JSON.stringify(version)}`);
  return [BigInt(match[1] ?? "0"), BigInt(match[2] ?? "0"), BigInt(match[3] ?? "0")];
}

/** Numeric order of `x.y.z`: -1, 0 or 1. Throws on anything else (a pre-release or build part, a missing part, a leading zero). */
export function compareSemver(a: string, b: string): number {
  const left = semverParts(a);
  const right = semverParts(b);
  for (let index = 0; index < 3; index += 1) {
    const x = left[index] ?? 0n;
    const y = right[index] ?? 0n;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function validDate(text: string): boolean {
  const match = DATE.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Releases from newest to oldest. `Unreleased` (version "Unreleased", date null) is first when present. Throws `ChangelogError`. */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | null = null;
  let inComment = false;
  let inForUsers = false;
  let pending: { en: string; line: number } | null = null;

  const closeItem = (): void => {
    if (pending !== null) throw new ChangelogError("changelog_for_users_item", pending.line);
  };

  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const number = index + 1;
    const raw = (lines[index] ?? "").replace(/\r$/, "");
    const text = raw.trim();

    if (inComment) {
      if (text.includes("-->")) inComment = false;
      continue;
    }
    if (text.startsWith("<!--")) {
      if (!text.includes("-->", 4)) inComment = true;
      continue;
    }
    if (LINK_LINE.test(text)) continue;

    if (raw.startsWith("## ")) {
      closeItem();
      inForUsers = false;
      const match = RELEASE_HEADING.exec(text);
      if (text === `## [${UNRELEASED}]`) {
        if (releases.length > 0) {
          throw new ChangelogError(
            releases.some((release) => release.version === UNRELEASED) ? "changelog_duplicate" : "changelog_order",
            number
          );
        }
        current = { version: UNRELEASED, date: null, forUsers: [] };
      } else {
        const version = match?.[1] ?? "";
        const date = match?.[2] ?? "";
        if (match === null || !SEMVER.test(version)) throw new ChangelogError("changelog_heading", number);
        if (!validDate(date)) throw new ChangelogError("changelog_date", number);
        const previous = [...releases].reverse().find((release) => release.version !== UNRELEASED);
        if (previous !== undefined) {
          const order = compareSemver(version, previous.version);
          if (order === 0) throw new ChangelogError("changelog_duplicate", number);
          if (order > 0) throw new ChangelogError("changelog_order", number);
        }
        current = { version, date, forUsers: [] };
      }
      releases.push(current);
      continue;
    }

    if (current === null) continue;

    if (raw.startsWith("### ")) {
      closeItem();
      inForUsers = text === FOR_USERS_HEADING;
      continue;
    }
    if (!inForUsers || text === "") {
      // A blank line between the two lines of an item breaks the item.
      if (pending !== null) closeItem();
      continue;
    }

    if (pending !== null) {
      const pl = PL_ITEM.exec(raw);
      if (pl === null) throw new ChangelogError("changelog_for_users_item", pending.line);
      current.forUsers.push({ en: pending.en, pl: (pl[1] ?? "").trim() });
      pending = null;
      continue;
    }
    const en = EN_ITEM.exec(raw);
    if (en === null) throw new ChangelogError("changelog_for_users_item", number);
    pending = { en: (en[1] ?? "").trim(), line: number };
  }
  closeItem();
  return releases;
}
