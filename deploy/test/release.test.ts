import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createHarness, GIB_BYTES, indexOfCall, type Harness } from "./release-harness";

// F114 stage 05, tests 4–11, 15, 16 and the extras: `deploy/release.sh <tag>` in a temp layout with recording stubs.
// Tests of `rollback.sh` are in rollback.test.ts.

let h: Harness;
const COMPOSE = "docker compose -f deploy/compose.yaml --env-file deploy/db.env";
const dockerCalls = (): string[] => h.calls().filter((line) => line.includes(" docker "));
const stateV010 = {
  current: "v0.1.0",
  current_commit: "commit-v0.1.0",
  previous: "v0.0.9",
  previous_commit: "commit-v0.0.9",
};

beforeEach(() => {
  h = createHarness();
});
afterEach(() => h.cleanup());

describe("release.sh refusals (exit 2, no change)", () => {
  test("4. a dirty tree exits 2 and calls no docker", () => {
    h.setSwitch("git-status", " M deploy/compose.yaml\n");
    const result = h.run("release.sh", ["v0.1.0"]);
    expect(result.code).toBe(2);
    expect(result.output).toContain("not clean");
    expect(dockerCalls()).toEqual([]);
    expect(h.state()).toBeNull();
  });

  test("5. package.json 0.1.1 at tag v0.1.0 exits 2", () => {
    h.setSwitch("package-version", "0.1.1\n");
    const result = h.run("release.sh", ["v0.1.0"]);
    expect(result.code).toBe(2);
    expect(result.output).toContain("0.1.1");
    expect(dockerCalls()).toEqual([]);
  });

  test("6. a tag that is not on origin/master exits 2", () => {
    h.setSwitch("not-ancestor");
    const result = h.run("release.sh", ["v0.1.0"]);
    expect(result.code).toBe(2);
    expect(result.output).toContain("origin/master");
    expect(h.calls().some((line) => line.includes("git merge-base --is-ancestor"))).toBe(true);
    expect(dockerCalls()).toEqual([]);
  });

  test("a tag that does not exist exits 2 before the backup", () => {
    h.setSwitch("missing-tag");
    const result = h.run("release.sh", ["v0.1.0"]);
    expect(result.code).toBe(2);
    expect(result.output).toContain("does not exist");
    expect(h.calls().some((line) => line.includes("deploy/backup.sh"))).toBe(false);
    expect(dockerCalls()).toEqual([]);
  });

  test("a name that is not v<major>.<minor>.<patch> exits 2 before any git or docker call", () => {
    for (const bad of ["", "0.1.0", "v0.1", "v0.1.0-rc1", "v0.1.0 x", "master"]) {
      expect(h.run("release.sh", bad === "" ? [] : [bad]).code, `tag '${bad}'`).toBe(2);
    }
    expect(h.calls()).toEqual([]);
  });

  test("a pending release and the current tag exit 2 and leave the state as it was", () => {
    h.writeState({ ...stateV010, pending: "v0.1.1" });
    const pending = h.run("release.sh", ["v0.1.2"]);
    expect(pending.code).toBe(2);
    expect(pending.output).toContain("pending");
    h.writeState(stateV010);
    const same = h.run("release.sh", ["v0.1.0"]);
    expect(same.code).toBe(2);
    expect(same.output).toContain("current release");
    expect(h.calls().some((line) => line.includes("deploy/backup.sh"))).toBe(false);
    expect(h.state()).toEqual({ ...stateV010, pending: "" });
  });
});

describe("release.sh env split", () => {
  const state = { current: "v0.9.0", current_commit: "commit-v0.9.0", previous: "", previous_commit: "" };

  test.each(["old", "mixed"] as const)(
    "state %s exits 2 first: no git, backup or docker call, no state write",
    (envState) => {
      h.setEnvState(envState);
      const result = h.run("release.sh", ["v0.9.1"]);
      expect(result.code).toBe(2);
      expect(result.output).toContain(`release refused: run deploy/env-split.sh first (state ${envState})`);
      expect(result.output).not.toContain("sentinel");
      expect(h.calls()).toEqual([]);
      expect(h.state()).toBeNull();
    }
  );

  test.each([
    ["the server env holds a key", "1\nserver env bad: APP_PASSWORD\n"],
    ["the server env cannot be read", "2\nserver env check failed: could not read the server env\n"],
  ])("when %s, the release fails at verify and the pending mark stays", (_name, switchText) => {
    h.writeState(state);
    h.setSwitch("env-check", switchText);
    const result = h.run("release.sh", ["v0.9.1"]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("release failed at verify; roll back with deploy/rollback.sh");
    expect(result.output).not.toContain("release ok");
    expect(h.state()).toEqual({ ...state, pending: "v0.9.1" });
  });

  test("a split host with a clean server env releases", () => {
    h.writeState(state);
    const result = h.run("release.sh", ["v0.9.1"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("release ok v0.9.1 previous v0.9.0");
    expect(h.calls().filter((line) => line.includes("check-server-env.sh"))).toHaveLength(1);
  });
});

describe("release.sh steps", () => {
  test("7. the calls run in order, the state moves current to previous, the last line says ok", () => {
    h.writeState({ current: "v0.1.0", current_commit: "commit-v0.1.0", previous: "", previous_commit: "" });
    const result = h.run("release.sh", ["v0.1.1"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("release ok v0.1.1 previous v0.1.0");
    const calls = h.calls();
    const order = [
      "deploy/backup.sh",
      "docker tag ea-server:latest ea-server:v0.1.0",
      "git checkout --detach v0.1.1",
      `EA_RELEASE=v0.1.1 ${COMPOSE} build server`,
      "docker tag ea-server:latest ea-server:v0.1.1",
      `${COMPOSE} run --rm -T migrate`,
      `${COMPOSE} up -d --no-build --wait`,
      `${COMPOSE} exec -T server printenv EA_RELEASE`,
      "deploy/check-server-env.sh",
    ].map((text) => indexOfCall(calls, text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h.state()).toEqual({
      current: "v0.1.1",
      current_commit: "commit-v0.1.1",
      previous: "v0.1.0",
      previous_commit: "commit-v0.1.0",
      pending: "",
    });
    expect(readdirSync(join(h.root, "deploy", "release-state"))).toEqual(["state"]);
  });

  test("9. the migrate step runs the migrate service, and no call runs db:migrate in cli", () => {
    h.writeState({ current: "v0.1.0", current_commit: "commit-v0.1.0", previous: "", previous_commit: "" });
    expect(h.run("release.sh", ["v0.1.1"]).code).toBe(0);
    const calls = h.calls();
    expect(calls.some((line) => line.endsWith(" run --rm -T migrate"))).toBe(true);
    expect(calls.some((line) => line.includes("cli bun run db:migrate"))).toBe(false);
  });

  test("every state write goes through a temp file and mv", () => {
    expect(h.run("release.sh", ["v0.1.0"]).code).toBe(0);
    const moves = h.calls().filter((line) => line.startsWith("mv "));
    expect(moves).toHaveLength(2);
    expect(new Set(moves)).toEqual(new Set(["mv deploy/release-state/state.tmp deploy/release-state/state"]));
  });

  test("backup.sh runs with $HOME/bin first on PATH when that folder exists", () => {
    h.run("release.sh", ["v0.1.0"], {});
    expect(h.calls().find((line) => line.startsWith("deploy/backup.sh"))).not.toContain(`PATH=${h.root}/bin:`);
    Bun.spawnSync(["mkdir", join(h.root, "bin")]);
    h.run("release.sh", ["v0.1.1"], {});
    const lines = h.calls().filter((line) => line.startsWith("deploy/backup.sh"));
    expect(lines.at(-1)).toContain(`PATH=${h.root}/bin:`);
  });

  test("8. with no state the running image is kept as pre-<tag> and becomes previous", () => {
    const result = h.run("release.sh", ["v0.1.0"]);
    expect(result.code).toBe(0);
    expect(h.calls()).toContain("EA_RELEASE= docker tag ea-server:latest ea-server:pre-v0.1.0");
    expect(h.state()).toEqual({
      current: "v0.1.0",
      current_commit: "commit-v0.1.0",
      previous: "pre-v0.1.0",
      previous_commit: "commit-head",
      pending: "",
    });
    expect(result.stdout.trim().split("\n").at(-1)).toBe("release ok v0.1.0 previous pre-v0.1.0");
  });

  test("8b. a failed first release leaves pending and a rollback target pre-<tag>", () => {
    h.setSwitch("curl-fail");
    expect(h.run("release.sh", ["v0.1.0"]).code).toBe(1);
    expect(h.state()).toMatchObject({ current: "pre-v0.1.0", current_commit: "commit-head", pending: "v0.1.0" });
    Bun.spawnSync(["rm", join(h.stubs, "curl-fail")]);
    const rollback = h.run("rollback.sh");
    expect(rollback.code).toBe(0);
    expect(rollback.stdout.trim().split("\n").at(-1)).toBe("rollback ok pre-v0.1.0");
    expect(h.calls()).toContain("EA_RELEASE= docker tag ea-server:pre-v0.1.0 ea-server:latest");
  });

  test("9. a backup without a `backup ok` last line exits 1 before any change", () => {
    h.setSwitch("backup-bad");
    const result = h.run("release.sh", ["v0.1.1"]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("release failed at backup");
    expect(result.output).not.toContain("rollback.sh");
    expect(h.calls().some((line) => line.includes("git checkout"))).toBe(false);
    expect(h.calls().some((line) => line.includes("docker tag"))).toBe(false);
    expect(h.state()).toBeNull();
  });

  test("9b. only stdout counts: a `backup ok` text on stderr does not pass a bad backup", () => {
    Bun.spawnSync(
      [
        "bash",
        "-c",
        `printf '#!/usr/bin/env bash\\necho "backup: failed"\\necho "backup ok x 1" >&2\\n' >deploy/backup.sh`,
      ],
      {
        cwd: h.root,
      }
    );
    const result = h.run("release.sh", ["v0.1.1"]);
    expect(result.code).toBe(1);
    expect(h.calls().some((line) => line.includes("git checkout"))).toBe(false);
  });

  test("10. 2 GB free twice stops the release; 2 GB then 5 GB prunes the builder once and goes on", () => {
    h.setSwitch("df-values", `${2 * GIB_BYTES}\n${2 * GIB_BYTES}\n`);
    const stopped = h.run("release.sh", ["v0.1.1"]);
    expect(stopped.code).toBe(1);
    expect(stopped.output).toContain("release failed at disk");
    expect(h.calls().filter((line) => line.includes("docker builder prune -f"))).toHaveLength(1);
    expect(h.calls().some((line) => line.includes("git checkout"))).toBe(false);
    expect(h.state()).toBeNull();

    h.setSwitch("df-values", `${2 * GIB_BYTES}\n${5 * GIB_BYTES}\n`);
    expect(h.run("release.sh", ["v0.1.1"]).code).toBe(0);
    expect(h.calls().filter((line) => line.includes("docker builder prune -f"))).toHaveLength(2);
  });

  test("10c. a df that fails, and a df that prints junk, stop the release at disk before any change", () => {
    for (const body of ["exit 1", "echo junk"]) {
      Bun.spawnSync(["bash", "-c", `printf '#!/usr/bin/env bash\n${body}\n' >stubs/df`], { cwd: h.root });
      const result = h.run("release.sh", ["v0.1.1"]);
      expect(result.code, body).toBe(1);
      expect(result.output).toContain("release failed at disk; nothing changed");
      expect(h.calls().some((line) => line.includes("git checkout") || line.includes("docker tag"))).toBe(false);
      expect(h.state()).toBeNull();
    }
  });

  test("10b. enough free space calls no prune", () => {
    h.setSwitch("df-values", `${3 * GIB_BYTES}\n`);
    expect(h.run("release.sh", ["v0.1.1"]).code).toBe(0);
    expect(h.calls().some((line) => line.includes("builder prune"))).toBe(false);
  });

  test("11. a failing health check exits 1, keeps pending and names rollback.sh", () => {
    h.writeState(stateV010);
    h.setSwitch("curl-fail");
    const result = h.run("release.sh", ["v0.1.1"]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("release failed at verify; roll back with deploy/rollback.sh");
    expect(h.state()).toMatchObject({ current: "v0.1.0", pending: "v0.1.1", previous: "v0.0.9" });
  });

  test("11b. a server that reports another release fails the verify step", () => {
    h.writeState(stateV010);
    const result = h.run("release.sh", ["v0.1.1"], { STUB_SERVER_RELEASE: "dev" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("release failed at verify");
    expect(h.state()?.pending).toBe("v0.1.1");
  });

  test("a failed migrate stops before `up`, keeps pending and never tries a rollback of the schema", () => {
    h.writeState(stateV010);
    h.setSwitch("docker-fail", "run --rm -T migrate");
    const result = h.run("release.sh", ["v0.1.1"]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("release failed at migrate; roll back with deploy/rollback.sh");
    expect(h.calls().some((line) => line.includes(" up -d"))).toBe(false);
    expect(h.state()?.pending).toBe("v0.1.1");
  });

  test("15. the prune keeps current and previous and removes the other v* and pre-* tags", () => {
    h.writeState({ ...stateV010, previous: "v0.0.9", previous_commit: "commit-v0.0.9" });
    h.setSwitch("images", "latest\nv0.0.9\nv0.1.0\nv0.1.1\npre-v0.0.1\n<none>\n");
    // after the release: current v0.1.1, previous v0.1.0
    const result = h.run("release.sh", ["v0.1.1"]);
    expect(result.code).toBe(0);
    const removed = h.calls().filter((line) => line.includes("docker rmi "));
    expect(removed.map((line) => line.split(" docker rmi ")[1])).toEqual(["ea-server:v0.0.9", "ea-server:pre-v0.0.1"]);
  });

  test("a failed removal only warns: the release stays ok", () => {
    h.writeState(stateV010);
    h.setSwitch("images", "v0.0.9\n");
    h.setSwitch("docker-fail", "rmi ea-server");
    const result = h.run("release.sh", ["v0.1.1"]);
    expect(result.code).toBe(0);
    expect(result.output).toContain("could not remove ea-server:v0.0.9");
    expect(h.state()?.current).toBe("v0.1.1");
  });

  test("16. no call holds db:rollback, and no call after the build has --build", () => {
    h.writeState(stateV010);
    expect(h.run("release.sh", ["v0.1.1"]).code).toBe(0);
    const calls = h.calls();
    expect(calls.some((line) => line.includes("db:rollback"))).toBe(false);
    const build = indexOfCall(calls, " build server");
    expect(build).toBeGreaterThan(-1);
    expect(calls.slice(build + 1).filter((line) => /(^| )--build( |$)/.test(line))).toEqual([]);
    expect(calls.slice(build).some((line) => /(^| )up( |$)/.test(line) && line.includes("--no-build"))).toBe(true);
  });
});

describe("state values", () => {
  const bad: [string, string, string][] = [
    ["current", "v0.1.0;rm", "a value with a semicolon"],
    ["previous_commit", "-q", "a value that starts with a dash"],
    ["current_commit", "a b", "a value with a space"],
  ];

  test.each(bad)(
    "a bad %s (%s: %s) exits 2 in release.sh and rollback.sh and reaches no git or docker call",
    (key, value) => {
      for (const script of ["release.sh", "rollback.sh"] as const) {
        h.writeState({ ...stateV010, [key]: value });
        const result = h.run(script, script === "release.sh" ? ["v0.1.1"] : []);
        expect(result.code, script).toBe(2);
        expect(result.output).toContain(`bad value for ${key}`);
        expect(h.calls().some((line) => line.includes("git checkout") || line.includes(" docker "))).toBe(false);
      }
    }
  );

  test("valid values with dots, dashes and a pre- prefix are kept", () => {
    h.writeState({ current: "pre-v0.1.0", current_commit: "commit-head", previous: "", previous_commit: "" });
    expect(h.run("release.sh", ["v0.1.1"]).code).toBe(0);
  });
});
