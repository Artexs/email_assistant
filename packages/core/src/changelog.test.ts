import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { ChangelogError, compareSemver, parseChangelog } from "./changelog";

const REAL = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8");

function problem(markdown: string): { message: string; line: number } {
  try {
    parseChangelog(markdown);
  } catch (error) {
    if (error instanceof ChangelogError) return { message: error.message.split(" ")[0] ?? "", line: error.line };
    throw error;
  }
  throw new Error("no ChangelogError");
}

const T1 = [
  "# Changelog",
  "",
  "## [0.2.0] - 2026-12-01",
  "",
  "### For users",
  "",
  "- en: Second item.",
  "  pl: Drugi punkt.",
  "",
  "## [0.1.0] - 2026-11-20",
  "",
  "### For users",
  "",
  "- en: First item.",
  "  pl: Pierwszy punkt.",
  "",
].join("\n");

describe("parseChangelog", () => {
  test("T1 two releases, newest first, with en and pl", () => {
    expect(parseChangelog(T1)).toEqual([
      { version: "0.2.0", date: "2026-12-01", forUsers: [{ en: "Second item.", pl: "Drugi punkt." }] },
      { version: "0.1.0", date: "2026-11-20", forUsers: [{ en: "First item.", pl: "Pierwszy punkt." }] },
    ]);
  });

  test("T2 Unreleased first has version Unreleased and date null", () => {
    const [first, second] = parseChangelog(`# Changelog\n\n## [Unreleased]\n\n${T1.slice(T1.indexOf("## [0.2.0]"))}`);
    expect(first).toEqual({ version: "Unreleased", date: null, forUsers: [] });
    expect(second?.version).toBe("0.2.0");
  });

  test("T3 an older release above a newer one is changelog_order at the second heading", () => {
    const text = "# C\n\n## [0.1.0] - 2026-11-20\n\n## [0.2.0] - 2026-12-01\n";
    expect(problem(text)).toEqual({ message: "changelog_order", line: 5 });
  });

  test("Unreleased below a release is changelog_order; a second Unreleased is changelog_duplicate", () => {
    expect(problem("## [0.1.0] - 2026-11-20\n\n## [Unreleased]\n")).toEqual({ message: "changelog_order", line: 3 });
    expect(problem("## [Unreleased]\n\n## [Unreleased]\n")).toEqual({ message: "changelog_duplicate", line: 3 });
  });

  test("the same version twice is changelog_duplicate, also with Unreleased above", () => {
    expect(problem("## [0.1.0] - 2026-11-20\n\n## [0.1.0] - 2026-11-21\n")).toEqual({
      message: "changelog_duplicate",
      line: 3,
    });
    expect(problem("## [Unreleased]\n## [0.1.0] - 2026-11-20\n## [0.1.0] - 2026-11-20\n")).toEqual({
      message: "changelog_duplicate",
      line: 3,
    });
  });

  test("T4 an item with en and no pl line is changelog_for_users_item at the item line", () => {
    const text = "## [0.1.0] - 2026-11-20\n\n### For users\n\n- en: Only English.\n\n### Added\n";
    expect(problem(text)).toEqual({ message: "changelog_for_users_item", line: 5 });
    expect(problem("## [0.1.0] - 2026-11-20\n### For users\n- en: A.\n")).toEqual({
      message: "changelog_for_users_item",
      line: 3,
    });
  });

  test("a For users line that is no item, or a pl line with no en line, is changelog_for_users_item", () => {
    const head = "## [0.1.0] - 2026-11-20\n### For users\n";
    expect(problem(`${head}- Plain text.\n`)).toEqual({ message: "changelog_for_users_item", line: 3 });
    expect(problem(`${head}  pl: Tylko polski.\n`)).toEqual({ message: "changelog_for_users_item", line: 3 });
    expect(problem(`${head}- en: A.\n  de: B.\n`)).toEqual({ message: "changelog_for_users_item", line: 3 });
    expect(problem(`${head}- en: \n  pl: B.\n`)).toEqual({ message: "changelog_for_users_item", line: 3 });
    expect(problem(`${head}- en: A.\n  pl: \n`)).toEqual({ message: "changelog_for_users_item", line: 3 });
  });

  test("an en line followed by another en line is changelog_for_users_item at the first line, never a joined pair", () => {
    const text = "## [0.1.0] - 2026-11-20\n### For users\n- en: A.\n- en: B.\n  pl: b.\n";
    expect(problem(text)).toEqual({ message: "changelog_for_users_item", line: 3 });
  });

  test("a comment hides every line in it: unindented headings, For users lines, and a comment between the lines of an item", () => {
    const text = [
      "<!--",
      "## [bad heading",
      "## [0.1.0] - 2026-13-99",
      "- en: not an item",
      "-->",
      "## [0.2.0] - 2026-12-01",
      "### For users",
      "- en: A.",
      "<!-- note -->",
      "  pl: a.",
      "<!--",
      "- en: B.",
      "-->",
      "",
    ].join("\n");
    expect(parseChangelog(text)).toEqual([
      { version: "0.2.0", date: "2026-12-01", forUsers: [{ en: "A.", pl: "a." }] },
    ]);
  });

  test("a For users group ends at the next release: a stray item line in the next release is not read", () => {
    const text = "## [0.2.0] - 2026-12-01\n### For users\n- en: A.\n  pl: a.\n## [0.1.0] - 2026-11-20\n- en: stray\n";
    expect(parseChangelog(text)).toEqual([
      { version: "0.2.0", date: "2026-12-01", forUsers: [{ en: "A.", pl: "a." }] },
      { version: "0.1.0", date: "2026-11-20", forUsers: [] },
    ]);
  });

  test("T5 a heading that is not plain SemVer is changelog_heading; a bad date is changelog_date", () => {
    expect(problem("## [0.2] - 2026-12-01\n")).toEqual({ message: "changelog_heading", line: 1 });
    expect(problem("# C\n## [0.2.0-rc.1] - 2026-12-01\n")).toEqual({ message: "changelog_heading", line: 2 });
    expect(problem("## [0.2.0]\n")).toEqual({ message: "changelog_heading", line: 1 });
    expect(problem("## [01.2.0] - 2026-12-01\n")).toEqual({ message: "changelog_heading", line: 1 });
    expect(problem("## Unreleased\n")).toEqual({ message: "changelog_heading", line: 1 });
    expect(problem("## [0.2.0] - 2026-13-01\n")).toEqual({ message: "changelog_date", line: 1 });
    expect(problem("## [0.2.0] - 2026-02-30\n")).toEqual({ message: "changelog_date", line: 1 });
    expect(problem("## [0.2.0] - 26-12-01\n")).toEqual({ message: "changelog_date", line: 1 });
    expect(parseChangelog("## [0.2.0] - 2028-02-29\n")[0]?.date).toBe("2028-02-29");
  });

  test("T7 a comment with an indented example heading and the end link lines are ignored", () => {
    const text = [
      "# Changelog",
      "",
      "<!--",
      "For users form:",
      "    ## [9.9.9] - 2026-12-31",
      "    ### For users",
      "    - en: Example.",
      "-->",
      "<!-- one line -->",
      "",
      "## [0.1.0] - 2026-11-20",
      "",
      "### For users",
      "",
      "- en: Real.",
      "  pl: Prawdziwy.",
      "",
      "[0.1.0]: https://example.com/releases/0.1.0",
      "[Unreleased]: https://example.com/compare/0.1.0...HEAD",
      "",
    ].join("\n");
    expect(parseChangelog(text)).toEqual([
      { version: "0.1.0", date: "2026-11-20", forUsers: [{ en: "Real.", pl: "Prawdziwy." }] },
    ]);
  });

  test("another group is free text and its items are not For users items", () => {
    const text = "## [0.1.0] - 2026-11-20\n\n### Added\n\n- en: Not a user item.\n- Free text.\n\n### Fixed\n\n- x\n";
    expect(parseChangelog(text)).toEqual([{ version: "0.1.0", date: "2026-11-20", forUsers: [] }]);
  });

  test("an item may hold text with a colon and the lines may end with CRLF", () => {
    const text = "## [0.1.0] - 2026-11-20\r\n### For users\r\n- en: Note: a thing.\r\n  pl: Uwaga: rzecz.\r\n";
    expect(parseChangelog(text)[0]?.forUsers).toEqual([{ en: "Note: a thing.", pl: "Uwaga: rzecz." }]);
  });

  test("several items keep their order", () => {
    const text = "## [0.1.0] - 2026-11-20\n### For users\n- en: A.\n  pl: a.\n- en: B.\n  pl: b.\n";
    expect(parseChangelog(text)[0]?.forUsers.map((item) => item.en)).toEqual(["A.", "B."]);
  });

  test("a file with no release gives an empty list", () => {
    expect(parseChangelog("# Changelog\n\nText.\n")).toEqual([]);
  });

  test("T8 the real CHANGELOG.md parses: Unreleased first, 0.1.0 present with no For users items", () => {
    const releases = parseChangelog(REAL);
    expect(releases[0]?.version).toBe("Unreleased");
    expect(releases[0]?.date).toBeNull();
    const first = releases.find((release) => release.version === "0.1.0");
    expect(first).toBeDefined();
    expect(first?.forUsers).toEqual([]);
  });
});

describe("compareSemver", () => {
  test("T6 numeric order, equal, and a throw on anything but x.y.z", () => {
    expect(compareSemver("0.10.0", "0.9.0")).toBe(1);
    expect(compareSemver("0.9.0", "0.10.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.2.10", "1.2.9")).toBeGreaterThan(0);
    expect(compareSemver("9007199254740993.0.0", "9007199254740992.0.0")).toBe(1);
    expect(() => compareSemver("1.0.0-rc.1", "1.0.0")).toThrow();
    expect(() => compareSemver("1.0.0", "1.0.0+build")).toThrow();
    expect(() => compareSemver("1.0", "1.0.0")).toThrow();
    expect(() => compareSemver("1.0.0", "01.0.0")).toThrow();
    expect(() => compareSemver("Unreleased", "1.0.0")).toThrow();
  });
});

describe("parseChangelog edge cases", () => {
  const RELEASE = "## [0.1.0] - 2026-11-20\n### For users\n";

  test("the error carries its name, its code and the line in the message", () => {
    let caught: unknown;
    try {
      parseChangelog("# C\n## [0.2] - 2026-12-01\n");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ChangelogError);
    expect((caught as ChangelogError).name).toBe("ChangelogError");
    expect((caught as ChangelogError).message).toBe("changelog_heading (line 2)");
    expect((caught as ChangelogError).line).toBe(2);
  });

  test.each([
    ["month 00", "2026-00-15"],
    ["day 00", "2026-01-00"],
  ])("a date with %s is changelog_date", (_name, date) => {
    expect(problem(`## [0.1.0] - ${date}\n`)).toEqual({ message: "changelog_date", line: 1 });
  });

  test.each(["2026-01-01", "2026-01-31", "2026-12-31"])("the date %s is valid", (date) => {
    expect(parseChangelog(`## [0.1.0] - ${date}\n`)[0]?.date).toBe(date);
  });

  test("a last item with no trailing newline is an error, not a silent drop", () => {
    expect(problem(`${RELEASE}- en: A.`)).toEqual({ message: "changelog_for_users_item", line: 3 });
  });

  test("a complete last pair with no trailing newline is kept", () => {
    expect(parseChangelog(`${RELEASE}- en: A.\n  pl: a.`)[0]?.forUsers).toEqual([{ en: "A.", pl: "a." }]);
  });

  test("a blank line between the en line and the pl line breaks the item", () => {
    expect(problem(`${RELEASE}- en: A.\n\n  pl: a.\n`)).toEqual({ message: "changelog_for_users_item", line: 3 });
  });

  test("an open item at the next release heading is an error at the item line, before the heading is read", () => {
    expect(problem(`${RELEASE}- en: A.\n## [bad]\n`)).toEqual({ message: "changelog_for_users_item", line: 3 });
  });

  test("an open item at another group heading is not paired with a later pl line", () => {
    expect(problem(`${RELEASE}- en: A.\n### Added\n### For users\n  pl: a.\n`)).toEqual({
      message: "changelog_for_users_item",
      line: 3,
    });
  });

  test("a second Unreleased after a release below the first Unreleased is changelog_duplicate", () => {
    expect(problem("## [Unreleased]\n## [0.1.0] - 2026-11-20\n## [Unreleased]\n")).toEqual({
      message: "changelog_duplicate",
      line: 3,
    });
  });

  test.each([
    [
      "a version above the last release",
      "## [0.3.0] - 2026-12-03\n## [0.2.0] - 2026-12-02\n## [0.2.5] - 2026-12-01\n",
      "changelog_order",
    ],
    [
      "the last release again",
      "## [0.3.0] - 2026-12-03\n## [0.2.0] - 2026-12-02\n## [0.2.0] - 2026-12-01\n",
      "changelog_duplicate",
    ],
  ])("three releases: %s is checked against the last one", (_name, text, message) => {
    expect(problem(text)).toEqual({ message, line: 3 });
  });

  test("For users lines before the first release heading are not read", () => {
    expect(parseChangelog("### For users\n- en: A.\n  pl: a.\n## [0.1.0] - 2026-11-20\n")).toEqual([
      { version: "0.1.0", date: "2026-11-20", forUsers: [] },
    ]);
  });

  test("an indented comment line, a trailing space on the group heading and trailing spaces on an item are trimmed", () => {
    const text = "## [0.1.0] - 2026-11-20\n### For users  \n  <!-- note -->\n- en: A.  \n  pl: a.  \n   \n";
    expect(parseChangelog(text)[0]?.forUsers).toEqual([{ en: "A.", pl: "a." }]);
  });

  test("a carriage return inside an item line is not dropped: the line is no item", () => {
    const text = "## [0.1.0] - 2026-11-20\r\n### For users\r\n- en: A\rB.\r\n  pl: a.\r\n";
    expect(problem(text)).toEqual({ message: "changelog_for_users_item", line: 3 });
  });
});

describe("compareSemver errors and order", () => {
  function message(a: string, b: string): string {
    try {
      compareSemver(a, b);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "no error";
  }

  test.each([
    ["1.2", "1.2.3", 'compare_semver "1.2"'],
    ["1.2.3", "1.2.3-rc.1", 'compare_semver "1.2.3-rc.1"'],
    ["01.2.3", "1.2.3", 'compare_semver "01.2.3"'],
  ])("%s against %s throws with the bad version in the message", (a, b, expected) => {
    expect(message(a, b)).toBe(expected);
  });

  test.each([
    ["1.2.3", "1.2.3", 0],
    ["1.10.0", "1.9.9", 1],
    ["0.0.1", "0.1.0", -1],
    ["2.0.0", "10.0.0", -1],
    ["1.2.4", "1.2.3", 1],
    ["1.2.3", "1.2.4", -1],
  ])("%s against %s is %i", (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });
});
