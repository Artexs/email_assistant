import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deployDecision, main, newestRelease, type GateRef } from "./deploy-gate";

const GATE_SCRIPT = join(import.meta.dir, "deploy-gate.ts");
const push = (name: string, type: GateRef["type"] = "tag"): GateRef => ({ event: "push", type, name });
const manual = (name: string, type: GateRef["type"]): GateRef => ({ event: "workflow_dispatch", type, name });

describe("deployDecision", () => {
  test("T2 the newest release tag deploys", () => {
    const decision = deployDecision(push("v0.2.0"), ["v0.1.0", "v0.2.0"]);
    expect(decision.deploy).toBe(true);
    expect(decision.error).toBeUndefined();
  });

  test("T3 an older release tag is skipped and names the newest", () => {
    const decision = deployDecision(push("v0.1.1"), ["v0.1.1", "v0.2.0"]);
    expect(decision).toEqual({ deploy: false, reason: "skip: v0.1.1 is not the newest release (v0.2.0)" });
  });

  test("T4 SemVer order, not text order", () => {
    expect(deployDecision(push("v0.10.0"), ["v0.9.0", "v0.10.0"]).deploy).toBe(true);
    expect(deployDecision(push("v0.9.0"), ["v0.9.0", "v0.10.0"]).deploy).toBe(false);
    expect(deployDecision(push("v1.0.0"), ["v0.99.99", "v1.0.0"]).deploy).toBe(true);
    expect(deployDecision(push("v2.0.0"), ["v10.0.0", "v2.0.0"]).deploy).toBe(false);
  });

  test("T5 a tag that is not plain SemVer is no release tag", () => {
    for (const name of ["vtest", "v1", "v1.2", "v0.2.0-rc.1", "v1.2.3+b", "v01.2.3", "v1.2.3.4", "V1.2.3", "v1.2.3 "]) {
      expect(deployDecision(push(name), [name, "v0.1.0"])).toEqual({
        deploy: false,
        reason: `skip: ${name} is not a release tag`,
      });
    }
  });

  test("a pre-release tag in the list never counts as newest", () => {
    expect(deployDecision(push("v0.2.0"), ["v0.2.0", "v0.3.0-rc.1", "vtest", "v1"]).deploy).toBe(true);
  });

  test("T6 a manual run on a branch deploys, with or without tags", () => {
    expect(deployDecision(manual("master", "branch"), []).deploy).toBe(true);
    expect(deployDecision(manual("master", "branch"), ["v0.2.0"]).deploy).toBe(true);
  });

  test("T6b a manual run on an old tag deploys (rollback)", () => {
    const decision = deployDecision(manual("v0.1.1", "tag"), ["v0.1.1", "v0.2.0"]);
    expect(decision.deploy).toBe(true);
    expect(decision.error).toBeUndefined();
  });

  test("a manual run on a tag that is no release tag deploys too", () => {
    expect(deployDecision(manual("vtest", "tag"), ["vtest", "v0.2.0"]).deploy).toBe(true);
  });

  test("a push of a branch never deploys", () => {
    expect(deployDecision(push("master", "branch"), ["v0.2.0"])).toEqual({
      deploy: false,
      reason: "skip: master is not a tag",
    });
  });

  test("the pushed tag counts when the tag list misses it", () => {
    expect(deployDecision(push("v0.2.0"), []).deploy).toBe(true);
    expect(deployDecision(push("v0.2.0"), ["v0.3.0"]).deploy).toBe(false);
  });

  test("the pushed tag equal to the newest of a list with blank lines and spaces deploys", () => {
    expect(deployDecision(push("v0.2.0"), ["", " v0.1.0 ", "v0.2.0\r", ""]).deploy).toBe(true);
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
      const decision = deployDecision(ref, ["v1.0.0"]);
      expect(decision.deploy).toBe(false);
      expect(decision.error).toBeString();
    }
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

  // A process run with a clean env (no .env is read: the cwd is a fresh folder).
  const run = (env: Record<string, string>, stdin: string) => {
    const result = Bun.spawnSync([process.execPath, GATE_SCRIPT], {
      env: { PATH: process.env.PATH ?? "", ...env },
      cwd: dir,
      stdin: new TextEncoder().encode(stdin),
    });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  };
  const outputFile = () => join(dir, "github-output");

  test("a skip prints its line, writes deploy=false and exits 0", () => {
    const result = run(
      { GATE_EVENT: "push", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.1.1", GITHUB_OUTPUT: outputFile() },
      "v0.1.1\nv0.2.0\n"
    );
    expect(result.code).toBe(0);
    expect(result.out).toBe("[deploy-gate] skip: v0.1.1 is not the newest release (v0.2.0)\n");
    expect(readFileSync(outputFile(), "utf8")).toBe("deploy=false\n");
  });

  test("a deploy writes deploy=true and exits 0", () => {
    const result = run(
      { GATE_EVENT: "push", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.10.0", GITHUB_OUTPUT: outputFile() },
      "v0.9.0\nv0.10.0\n"
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("deploy: v0.10.0 is the newest release");
    expect(readFileSync(outputFile(), "utf8")).toBe("deploy=true\n");
  });

  test("a manual run on an old tag deploys", () => {
    const result = run(
      { GATE_EVENT: "workflow_dispatch", GATE_REF_TYPE: "tag", GATE_REF_NAME: "v0.1.1", GITHUB_OUTPUT: outputFile() },
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
    const result = run({ GATE_EVENT: "workflow_dispatch", GATE_REF_TYPE: "branch", GATE_REF_NAME: "master" }, "");
    expect(result.code).toBe(0);
    expect(result.out).toContain("deploy: manual run on branch master");
  });

  test("main reads the tags only through the reader it gets", async () => {
    let calls = 0;
    const code = await main(
      { GATE_EVENT: "workflow_dispatch", GATE_REF_TYPE: "branch", GATE_REF_NAME: "master" },
      async () => {
        calls += 1;
        return "";
      }
    );
    expect(code).toBe(0);
    expect(calls).toBe(1);
  });
});
