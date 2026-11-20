import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { isGreaterVersion } from "./lib/release-prepare-lib";
import { parseReleasePrepareArgs } from "./release-prepare-args";

const script = join(import.meta.dir, "release-prepare.ts");
let work = "";
let counter = 0;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "f114-s06-prepare-"));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

// A nested "version" key comes first: only the top-level one is the release version.
const packageText = (version: string) =>
  `{\n  "name": "x",\n  "meta": {\n    "version": "9.9.9"\n  },\n  "version": "${version}"\n}\n`;

const twoItems = `# Changelog

## [Unreleased]

### Added

- First item.
- Second item.

### Fixed

### Removed

- Gone item.

## [0.0.1] - 2026-11-01

### Added

- Old item.
`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  changelog: string;
  packageJson: string;
}

async function prepare(args: string[], version: string, changelog: string): Promise<Run> {
  counter += 1;
  const dir = join(work, `case-${counter}`);
  mkdirSync(dir);
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  writeFileSync(join(dir, "package.json"), packageText(version));
  const run = Bun.spawn([process.execPath, script, ...args, "--root", dir], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  return {
    code,
    stdout,
    stderr,
    changelog: readFileSync(join(dir, "CHANGELOG.md"), "utf8"),
    packageJson: readFileSync(join(dir, "package.json"), "utf8"),
  };
}

describe("release:prepare", () => {
  test("14. moves the items to the new version and leaves an empty Unreleased", async () => {
    const result = await prepare(["0.1.0", "--date", "2026-11-20"], "0.0.1", twoItems);
    expect(result.code).toBe(0);
    expect(result.packageJson).toBe(packageText("0.1.0"));
    expect(result.changelog).toBe(`# Changelog

## [Unreleased]

## [0.1.0] - 2026-11-20

### Added

- First item.
- Second item.

### Removed

- Gone item.

## [0.0.1] - 2026-11-01

### Added

- Old item.
`);
  });

  test("14b. prints the next commands and runs no git command", async () => {
    const result = await prepare(["0.1.0", "--date", "2026-11-20"], "0.0.1", twoItems);
    expect(result.stdout).toContain('git tag -a v0.1.0 -m "v0.1.0"');
    expect(result.stdout).toContain("git push origin v0.1.0");
    expect(result.stdout).toContain('git commit -m "Release v0.1.0"');
  });

  test("14c. the first release with no older section", async () => {
    const result = await prepare(
      ["0.1.0", "--date", "2026-11-20"],
      "0.0.1",
      "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- One.\n"
    );
    expect(result.code).toBe(0);
    expect(result.changelog).toBe("# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-11-20\n\n### Added\n\n- One.\n");
  });

  test("14d. a date from the clock is today in UTC", async () => {
    const result = await prepare(["0.1.0"], "0.0.1", twoItems);
    expect(result.changelog).toContain(`## [0.1.0] - ${new Date().toISOString().slice(0, 10)}`);
  });

  test("15. a version that is not greater is refused with exit 2 and no change", async () => {
    for (const version of ["0.0.1", "0.0.0"]) {
      const result = await prepare([version, "--date", "2026-11-20"], "0.0.1", twoItems);
      expect(result.code).toBe(2);
      expect(result.changelog).toBe(twoItems);
      expect(result.packageJson).toBe(packageText("0.0.1"));
    }
  });

  test("15b. a version that is not x.y.z is refused", async () => {
    for (const version of ["v0.1.0", "0.1", "0.1.0-rc1", "01.x.0"]) {
      const result = await prepare([version], "0.0.1", twoItems);
      expect(result.code).toBe(2);
      expect(result.changelog).toBe(twoItems);
    }
  });

  test("16. an empty Unreleased is refused with exit 2 and no change", async () => {
    const empty = "# Changelog\n\n## [Unreleased]\n\n### Added\n\n## [0.0.1] - 2026-11-01\n\n- Old item.\n";
    const result = await prepare(["0.1.0", "--date", "2026-11-20"], "0.0.1", empty);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unreleased has no item");
    expect(result.changelog).toBe(empty);
    expect(result.packageJson).toBe(packageText("0.0.1"));
  });

  test("16b. no Unreleased heading is refused", async () => {
    const result = await prepare(["0.1.0"], "0.0.1", "# Changelog\n");
    expect(result.code).toBe(2);
  });
});

describe("release-prepare helpers", () => {
  test("version order is numeric", () => {
    expect(isGreaterVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isGreaterVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isGreaterVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isGreaterVersion("0.1.1", "0.2.0")).toBe(false);
  });

  test("arguments", () => {
    expect(parseReleasePrepareArgs(["0.1.0"])).toEqual({ version: "0.1.0", date: null, root: "." });
    expect(parseReleasePrepareArgs(["0.1.0", "--date", "2026-11-20", "--root", "x"])).toEqual({
      version: "0.1.0",
      date: "2026-11-20",
      root: "x",
    });
    expect(parseReleasePrepareArgs([])).toBeNull();
    expect(parseReleasePrepareArgs(["0.1.0", "0.2.0"])).toBeNull();
    expect(parseReleasePrepareArgs(["0.1.0", "--date", "today"])).toBeNull();
  });
});
