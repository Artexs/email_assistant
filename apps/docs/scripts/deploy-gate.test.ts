import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OWNER_REVIEW_PENDING } from "../src/publish-gate";
import { deployDecision, main, newestRelease, releasedVersions, type GateRef } from "./deploy-gate";

const GATE_SCRIPT = join(import.meta.dir, "deploy-gate.ts");
const push = (name: string, type: GateRef["type"] = "tag"): GateRef => ({ event: "push", type, name });
const manual = (name: string, type: GateRef["type"]): GateRef => ({ event: "workflow_dispatch", type, name });

// The rules before the hold: no page waits for the owner.
const decide = (ref: GateRef, tags: readonly string[], releases: readonly string[]) =>
  deployDecision(ref, tags, releases, [], false);

// The versions of the changelog fixture: every tag of the tests below has its release.
const ALL = ["0.1.0", "0.1.1", "0.2.0", "0.3.0", "0.4.0", "0.9.0", "0.10.0", "0.99.99", "1.0.0", "2.0.0", "10.0.0"];

describe("deployDecision", () => {
  test("T11 a pushed tag without its changelog release is an error, with it the tag deploys", () => {
    const missing = decide(push("v0.2.0"), ["v0.1.0", "v0.2.0"], ["0.1.0"]);
    expect(missing).toEqual({ deploy: false, reason: "no changelog release 0.2.0", error: "changelog_missing 0.2.0" });
    const there = decide(push("v0.2.0"), ["v0.1.0", "v0.2.0"], ["0.2.0", "0.1.0"]);
    expect(there).toEqual({ deploy: true, reason: "v0.2.0 is the newest release" });
  });

  test("the changelog error comes before the newest-release skip, and no release list means an error", () => {
    expect(decide(push("v0.1.1"), ["v0.1.1", "v0.2.0"], ["0.2.0"]).error).toBe("changelog_missing 0.1.1");
    expect(decide(push("v0.2.0"), [], []).error).toBe("changelog_missing 0.2.0");
  });

  test("the changelog is compared by version text: 0.2.0 does not satisfy v0.2.1, and a tag that is no release tag needs no release", () => {
    expect(decide(push("v0.2.1"), [], ["0.2.0"]).error).toBe("changelog_missing 0.2.1");
    expect(decide(push("v0.2.0-rc.1"), [], []).error).toBeUndefined();
  });

  test("a manual run and a branch push never need a changelog release", () => {
    expect(decide(manual("v0.9.9", "tag"), ["v0.9.9"], []).deploy).toBe(true);
    expect(decide(manual("master", "branch"), [], []).deploy).toBe(true);
    expect(decide(push("master", "branch"), [], []).error).toBeUndefined();
  });

  test("T2 the newest release tag deploys", () => {
    const decision = decide(push("v0.2.0"), ["v0.1.0", "v0.2.0"], ALL);
    expect(decision.deploy).toBe(true);
    expect(decision.error).toBeUndefined();
  });

  test("T3 an older release tag is skipped and names the newest", () => {
    const decision = decide(push("v0.1.1"), ["v0.1.1", "v0.2.0"], ALL);
    expect(decision).toEqual({ deploy: false, reason: "skip: v0.1.1 is not the newest release (v0.2.0)" });
  });

  test("T4 SemVer order, not text order", () => {
    expect(decide(push("v0.10.0"), ["v0.9.0", "v0.10.0"], ALL).deploy).toBe(true);
    expect(decide(push("v0.9.0"), ["v0.9.0", "v0.10.0"], ALL).deploy).toBe(false);
    expect(decide(push("v1.0.0"), ["v0.99.99", "v1.0.0"], ALL).deploy).toBe(true);
    expect(decide(push("v2.0.0"), ["v10.0.0", "v2.0.0"], ALL).deploy).toBe(false);
  });

  test("T5 a tag that is not plain SemVer is no release tag", () => {
    for (const name of [
      "vtest",
      "v1",
      "v1.2",
      "v0.2.0-rc.1",
      "v1.2.3+b",
      "v01.2.3",
      "v1.2.3.4",
      "V1.2.3",
      "v1.2.3 ",
      "pv1.2.3",
      "xv0.2.0",
    ]) {
      expect(decide(push(name), [name, "v0.1.0"], ALL)).toEqual({
        deploy: false,
        reason: `skip: ${name} is not a release tag`,
      });
    }
  });

  test("T7 the tag of the demo video release deploys nothing, whatever the tag list holds", () => {
    expect(decide(push("demo-video"), ["demo-video", "v0.1.0"], ALL)).toEqual({
      deploy: false,
      reason: "skip: demo-video is not a release tag",
    });
  });

  test("a pre-release tag in the list never counts as newest", () => {
    expect(decide(push("v0.2.0"), ["v0.2.0", "v0.3.0-rc.1", "vtest", "v1"], ALL).deploy).toBe(true);
  });

  test("T6 a manual run on a branch deploys, with or without tags", () => {
    expect(decide(manual("master", "branch"), [], ALL).deploy).toBe(true);
    expect(decide(manual("master", "branch"), ["v0.2.0"], ALL).deploy).toBe(true);
  });

  test("T6b a manual run on an old tag deploys (rollback)", () => {
    const decision = decide(manual("v0.1.1", "tag"), ["v0.1.1", "v0.2.0"], ALL);
    expect(decision.deploy).toBe(true);
    expect(decision.error).toBeUndefined();
  });

  test("a manual run on a tag that is no release tag deploys too", () => {
    expect(decide(manual("vtest", "tag"), ["vtest", "v0.2.0"], ALL).deploy).toBe(true);
  });

  test("a push of a branch never deploys", () => {
    expect(decide(push("master", "branch"), ["v0.2.0"], ALL)).toEqual({
      deploy: false,
      reason: "skip: master is not a tag",
    });
  });

  test("the pushed tag counts when the tag list misses it", () => {
    expect(decide(push("v0.2.0"), [], ALL).deploy).toBe(true);
    expect(decide(push("v0.2.0"), ["v0.3.0"], ALL).deploy).toBe(false);
    expect(decide(push("v0.4.0"), ["v0.3.0"], ALL).deploy).toBe(true);
  });

  test("the pushed tag equal to the newest of a list with blank lines and spaces deploys", () => {
    expect(decide(push("v0.2.0"), ["", " v0.1.0 ", "v0.2.0\r", ""], ALL).deploy).toBe(true);
    // A list entry with a line end or spaces still counts as a release.
    expect(decide(push("v0.1.0"), ["", " v0.2.0\r"], ALL)).toEqual({
      deploy: false,
      reason: "skip: v0.1.0 is not the newest release (v0.2.0)",
    });
  });

  test("a bad input is an error that fails the run", () => {
    const bad = [
      { event: "schedule", type: "branch", name: "master" },
      { event: "push", type: "pull", name: "v1.0.0" },
      { event: "push", type: "tag", name: "" },
      { event: "workflow_dispatch", type: "tag", name: "  " },
      { event: "", type: "", name: "" },
    ] as unknown as GateRef[];
    for (const ref of bad) {
      const decision = decide(ref, ["v1.0.0"], ALL);
      expect(decision.deploy).toBe(false);
      expect(decision.error).toBeString();
    }
  });
});

describe("deployDecision with a page that waits for the owner", () => {
  const pending = ["security"];
  const tags = ["v0.2.0", "v0.3.0"];
  const releases = ["0.2.0", "0.3.0"];

  test("T1 the newest tag is a skip that names the pending page, with no error", () => {
    expect(deployDecision(push("v0.3.0"), tags, releases, pending, false)).toEqual({
      deploy: false,
      reason: "skip: owner_review_pending security",
    });
    expect(deployDecision(push("v0.3.0"), tags, releases, ["index", "security"], false).reason).toBe(
      "skip: owner_review_pending index security"
    );
  });

  test("T2 with no pending page the same tag deploys", () => {
    expect(deployDecision(push("v0.3.0"), tags, releases, [], false)).toEqual({
      deploy: true,
      reason: "v0.3.0 is the newest release",
    });
  });

  test("the box publish_held_pages does not matter when the list is empty", () => {
    expect(deployDecision(push("v0.3.0"), tags, releases, [], true).deploy).toBe(true);
    expect(deployDecision(manual("master", "branch"), [], releases, [], false).deploy).toBe(true);
  });

  test("T3 a manual run skips without the box and deploys with it", () => {
    expect(deployDecision(manual("master", "branch"), [], releases, pending, false)).toEqual({
      deploy: false,
      reason: "skip: owner_review_pending security",
    });
    const rollback = deployDecision(manual("v0.2.0", "tag"), tags, releases, pending, true);
    expect(rollback).toEqual({ deploy: true, reason: "manual run on tag v0.2.0" });
  });

  test("a pushed tag ignores the box: only a manual run can lift the hold", () => {
    expect(deployDecision(push("v0.3.0"), tags, releases, pending, true).deploy).toBe(false);
  });

  test("T4 a tag without its changelog release is still the red changelog_missing", () => {
    expect(deployDecision(push("v0.3.0"), tags, ["0.2.0"], pending, false).error).toBe("changelog_missing 0.3.0");
  });

  test("T5 an older tag still says it is not the newest release", () => {
    expect(deployDecision(push("v0.2.0"), tags, releases, pending, false)).toEqual({
      deploy: false,
      reason: "skip: v0.2.0 is not the newest release (v0.3.0)",
    });
  });

  test("a branch push and a tag that is no release tag keep their own skip", () => {
    expect(deployDecision(push("master", "branch"), tags, releases, pending, false).reason).toBe(
      "skip: master is not a tag"
    );
    expect(deployDecision(push("vtest"), tags, releases, pending, false).reason).toBe(
      "skip: vtest is not a release tag"
    );
  });
});

describe("releasedVersions", () => {
  test("the versions of the released entries, newest first, without Unreleased", () => {
    const text = "# C\n\n## [Unreleased]\n\n## [0.2.0] - 2026-12-01\n\n## [0.1.0] - 2026-11-20\n";
    expect(releasedVersions(text)).toEqual(["0.2.0", "0.1.0"]);
    expect(releasedVersions("# C\n## [Unreleased]\n")).toEqual([]);
  });
});

describe("newestRelease", () => {
  test("picks the highest plain release tag", () => {
    expect(newestRelease(["v0.9.0", "v0.10.0", "v0.2.0"])).toBe("v0.10.0");
    expect(newestRelease(["v1.0.0", "v1.0.1", "v0.99.0"])).toBe("v1.0.1");
    expect(newestRelease(["v1.2.3", "v1.2.10", "v1.2.9"])).toBe("v1.2.10");
  });

  test("compares large numbers by value", () => {
    expect(newestRelease(["v9007199254740993.0.0", "v9007199254740992.0.0"])).toBe("v9007199254740993.0.0");
    expect(newestRelease(["v9007199254740992.0.0", "v9007199254740993.0.0"])).toBe("v9007199254740993.0.0");
  });

  test("returns null when no tag is a release tag", () => {
    expect(newestRelease([])).toBeNull();
    expect(newestRelease(["vtest", "v1", "v1.0.0-rc.1"])).toBeNull();
  });
});

describe("the script", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "deploy-gate-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const releaseHeadings = (versions: string[]) =>
    versions.map((version) => `## [${version}] - 2026-11-20\n`).join("\n");
  // A process run with a clean env (no .env is read: the cwd is a fresh folder). The changelog is a fixture file under `dir`
  // (`changelog: null` runs the real repository file).
  const run = (
    env: Record<string, string>,
    stdin: string,
    changelog: string | null = releaseHeadings(["0.10.0", "0.2.0", "0.1.1"])
  ) => {
    const fixtureEnv: Record<string, string> = {};
    if (changelog !== null) {
      mkdirSync(join(dir, "root"), { recursive: true });
      writeFileSync(join(dir, "root", "CHANGELOG.md"), `# Changelog\n\n${changelog}`);
      fixtureEnv.EA_DOCS_REPO_ROOT = join(dir, "root");
    }
    const result = Bun.spawnSync([process.execPath, GATE_SCRIPT], {
      env: { PATH: process.env.PATH ?? "", ...fixtureEnv, ...env },
      cwd: dir,
      stdin: new TextEncoder().encode(stdin),
    });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  };
  const outputFile = () => join(dir, "github-output");
  // The same run in this process, with the hold list the test names (the script reads its list only from `main`'s parameter).
  const runMain = async (env: Record<string, string>, stdin: string, pending: readonly string[], changelog: string) =>
    main(
      env,
      async () => stdin,
      () => `# Changelog\n\n${changelog}`,
      pending
    );

  test("a skip prints its line, writes deploy=false and exits 0", () => {
    const result = run(
      { GATE_EVENT: "push", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.1.1", GITHUB_OUTPUT: outputFile() },
      "v0.1.1\nv0.2.0\n"
    );
    expect(result.code).toBe(0);
    expect(result.out).toBe("[deploy-gate] skip: v0.1.1 is not the newest release (v0.2.0)\n");
    expect(readFileSync(outputFile(), "utf8")).toBe("deploy=false\n");
  });

  test("T6 a deploy with an empty hold list writes deploy=true and exits 0", async () => {
    const code = await runMain(
      { GATE_EVENT: "push", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.10.0", GITHUB_OUTPUT: outputFile() },
      "v0.9.0\nv0.10.0\n",
      [],
      releaseHeadings(["0.10.0"])
    );
    expect(code).toBe(0);
    expect(readFileSync(outputFile(), "utf8")).toBe("deploy=true\n");
  });

  test("T6 with the real hold list the newest tag is a skip: deploy=false, exit 0", () => {
    expect(OWNER_REVIEW_PENDING.length).toBeGreaterThan(0);
    const result = run(
      { GATE_EVENT: "push", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.10.0", GITHUB_OUTPUT: outputFile() },
      "v0.9.0\nv0.10.0\n"
    );
    expect(result.code).toBe(0);
    expect(result.out).toBe(`[deploy-gate] skip: owner_review_pending ${OWNER_REVIEW_PENDING.join(" ")}\n`);
    expect(readFileSync(outputFile(), "utf8")).toBe("deploy=false\n");
  });

  test("no env value lifts the hold of a pushed tag", () => {
    const result = run(
      {
        GATE_EVENT: "push",
        GATE_REF_TYPE: "tag",
        GATE_REF_NAME: "v0.10.0",
        GITHUB_OUTPUT: outputFile(),
        GATE_PUBLISH_HELD: "true",
        GATE_PENDING: "",
        OWNER_REVIEW_PENDING: "",
      },
      "v0.10.0\n"
    );
    expect(readFileSync(outputFile(), "utf8")).toBe("deploy=false\n");
    expect(result.out).toContain("owner_review_pending");
  });

  test("T3 a manual run skips without GATE_PUBLISH_HELD=true (any other value too) and deploys with it", () => {
    for (const held of [undefined, "", "false", "TRUE", "1"]) {
      const result = run(
        {
          GATE_EVENT: "workflow_dispatch",
          GATE_REF_TYPE: "branch",
          GATE_REF_NAME: "master",
          GITHUB_OUTPUT: outputFile(),
          ...(held === undefined ? {} : { GATE_PUBLISH_HELD: held }),
        },
        ""
      );
      expect(result.out).toContain("skip: owner_review_pending");
    }
    expect(readFileSync(outputFile(), "utf8")).toBe(
      "deploy=false\ndeploy=false\ndeploy=false\ndeploy=false\ndeploy=false\n"
    );
  });

  test("a manual run on an old tag deploys with the box", () => {
    const result = run(
      {
        GATE_EVENT: "workflow_dispatch",
        GATE_REF_TYPE: "tag",
        GATE_REF_NAME: "v0.1.1",
        GATE_PUBLISH_HELD: "true",
        GITHUB_OUTPUT: outputFile(),
      },
      "v0.1.1\nv0.2.0\n"
    );
    expect(result.code).toBe(0);
    expect(readFileSync(outputFile(), "utf8")).toBe("deploy=true\n");
  });

  test("a bad input exits 1, writes no output and prints on stderr", () => {
    const result = run({ GATE_EVENT: "push", GATE_REF_TYPE: "tag", GITHUB_OUTPUT: outputFile() }, "v1.0.0\n");
    expect(result.code).toBe(1);
    expect(result.err).toContain("[deploy-gate] error:");
    expect(result.out).toBe("");
    expect(() => readFileSync(outputFile(), "utf8")).toThrow();
  });

  test("it works without GITHUB_OUTPUT", () => {
    const result = run(
      { GATE_EVENT: "workflow_dispatch", GATE_REF_TYPE: "branch", GATE_REF_NAME: "master", GATE_PUBLISH_HELD: "true" },
      ""
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("deploy: manual run on branch master");
  });

  test("T11 a pushed tag without its changelog release exits 1, names it on stderr and writes no output", () => {
    const result = run(
      { GATE_EVENT: "push", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.3.0", GITHUB_OUTPUT: outputFile() },
      "v0.2.0\nv0.3.0\n"
    );
    expect(result.code).toBe(1);
    expect(result.err).toBe("[deploy-gate] error: changelog_missing 0.3.0\n");
    expect(result.out).toBe("");
    expect(() => readFileSync(outputFile(), "utf8")).toThrow();
  });

  test("an Unreleased heading is no release", () => {
    const result = run(
      { GATE_EVENT: "push", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.3.0", GITHUB_OUTPUT: outputFile() },
      "v0.3.0\n",
      `## [Unreleased]\n\n${releaseHeadings(["0.2.0"])}`
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain("changelog_missing 0.3.0");
  });

  test("a changelog that does not parse fails the gate with its error and line", () => {
    const result = run(
      {
        GATE_EVENT: "workflow_dispatch",
        GATE_REF_TYPE: "branch",
        GATE_REF_NAME: "master",
        GITHUB_OUTPUT: outputFile(),
      },
      "",
      "## [0.1.0] - 2026-11-20\n\n## [0.2.0] - 2026-11-21\n"
    );
    expect(result.code).toBe(1);
    expect(result.err).toBe("[deploy-gate] error: changelog_order (line 5)\n");
    expect(() => readFileSync(outputFile(), "utf8")).toThrow();
  });

  test("the real CHANGELOG.md has the release of tag v0.1.0", async () => {
    const code = await main(
      { GATE_EVENT: "push", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.1.0", GITHUB_OUTPUT: outputFile() },
      async () => "v0.1.0\n",
      () => readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8"),
      []
    );
    expect(code).toBe(0);
    expect(readFileSync(outputFile(), "utf8")).toBe("deploy=true\n");
  });

  test("main reads the tags only through the reader it gets", async () => {
    let calls = 0;
    const code = await main(
      { GATE_EVENT: "workflow_dispatch", GATE_REF_TYPE: "branch", GATE_REF_NAME: "master" },
      async () => {
        calls += 1;
        return "";
      },
      () => "# Changelog\n"
    );
    expect(code).toBe(0);
    expect(calls).toBe(1);
  });
});
