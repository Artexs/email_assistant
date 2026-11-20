import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createHarness, indexOfCall, type Harness } from "./release-harness";

// F114 stage 05, tests 12–14 and 16: `deploy/rollback.sh` in a temp layout with recording stubs (see release-harness.ts).

let h: Harness;
const COMPOSE = "docker compose -f deploy/compose.yaml --env-file deploy/db.env";
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

describe("rollback.sh", () => {
  test("11. db.env present and the target has no deploy/compose-lib.sh: exit 2, no docker call, state unchanged", () => {
    h.writeState({
      ...stateV010,
      current: "v0.1.1",
      current_commit: "commit-v0.1.1",
      previous: "v0.1.0",
      previous_commit: "commit-v0.1.0",
    });
    const before = readFileSync(join(h.root, "deploy", "release-state", "state"), "utf8");
    h.setSwitch("no-compose-lib");
    writeFileSync(join(h.root, "deploy", "db.env"), "POSTGRES_PASSWORD=x\n");
    const refused = h.run("rollback.sh");
    expect(refused.code).toBe(2);
    expect(refused.output).toContain(
      "rollback refused: run deploy/env-split.sh --undo first (target v0.1.0 reads only .env)"
    );
    expect(h.calls().some((line) => line.includes("docker"))).toBe(false);
    expect(readFileSync(join(h.root, "deploy", "release-state", "state"), "utf8")).toBe(before);

    // a target that has the helper rolls back on a split host
    Bun.spawnSync(["rm", `${h.stubs}/no-compose-lib`]);
    expect(h.run("rollback.sh").code).toBe(0);
  });

  test("a host that is not split exits 2 and changes nothing; a split host rolls back and runs no env check", () => {
    const state = {
      ...stateV010,
      current: "v0.1.1",
      current_commit: "commit-v0.1.1",
      previous: "v0.1.0",
      previous_commit: "commit-v0.1.0",
    };
    h.writeState(state);
    const before = readFileSync(join(h.root, "deploy", "release-state", "state"), "utf8");
    for (const envState of ["old", "mixed"] as const) {
      h.setEnvState(envState);
      const refused = h.run("rollback.sh");
      expect(refused.code, envState).toBe(2);
      expect(refused.output).toContain(`rollback refused: run deploy/env-split.sh first (state ${envState})`);
      expect(refused.output).not.toContain("sentinel");
      expect(h.calls(), envState).toEqual([]);
      expect(readFileSync(join(h.root, "deploy", "release-state", "state"), "utf8")).toBe(before);
    }

    h.setEnvState("split");
    const result = h.run("rollback.sh");
    expect(result.code).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("rollback ok v0.1.0");
    expect(h.calls().some((line) => line.includes("check-server-env.sh"))).toBe(false);
  });

  test("12. after a failed release the target is current: retag, checkout, up --no-build, pending cleared", () => {
    h.writeState(stateV010);
    h.setSwitch("curl-fail");
    expect(h.run("release.sh", ["v0.1.1"]).code).toBe(1);
    Bun.spawnSync(["rm", `${h.stubs}/curl-fail`]);
    const before = h.calls().length;

    const result = h.run("rollback.sh");
    expect(result.code).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("rollback ok v0.1.0");
    const calls = h.calls().slice(before);
    const order = [
      "docker tag ea-server:v0.1.0 ea-server:latest",
      "git checkout --detach commit-v0.1.0",
      `EA_RELEASE=v0.1.0 ${COMPOSE} up -d --no-build --wait`,
    ].map((text) => indexOfCall(calls, text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h.state()).toEqual({ ...stateV010, pending: "" });
  });

  test("13. with no pending the target is previous, and current and previous swap", () => {
    h.writeState({
      ...stateV010,
      current: "v0.1.1",
      current_commit: "commit-v0.1.1",
      previous: "v0.1.0",
      previous_commit: "commit-v0.1.0",
    });
    const result = h.run("rollback.sh");
    expect(result.code).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("rollback ok v0.1.0");
    expect(h.calls()).toContain("EA_RELEASE= docker tag ea-server:v0.1.0 ea-server:latest");
    expect(h.state()).toEqual({
      current: "v0.1.0",
      current_commit: "commit-v0.1.0",
      previous: "v0.1.1",
      previous_commit: "commit-v0.1.1",
      pending: "",
    });
    // a second run goes forward again
    expect(h.run("rollback.sh").stdout.trim().split("\n").at(-1)).toBe("rollback ok v0.1.1");
  });

  test("14. a missing target image exits 2 and leaves the state and the calls free of change", () => {
    h.writeState({
      ...stateV010,
      current: "v0.1.1",
      current_commit: "commit-v0.1.1",
      previous: "v0.1.0",
      previous_commit: "commit-v0.1.0",
    });
    h.setSwitch("missing-images", "ea-server:v0.1.0\n");
    const result = h.run("rollback.sh");
    expect(result.code).toBe(2);
    expect(result.output).toContain("ea-server:v0.1.0");
    expect(h.calls().some((line) => line.includes("docker tag") || line.includes("git checkout"))).toBe(false);
    expect(h.state()).toEqual({
      current: "v0.1.1",
      current_commit: "commit-v0.1.1",
      previous: "v0.1.0",
      previous_commit: "commit-v0.1.0",
      pending: "",
    });
  });

  test("no state, or no target in the state, exits 2", () => {
    expect(h.run("rollback.sh").code).toBe(2);
    h.writeState({ current: "v0.1.0", current_commit: "commit-v0.1.0" });
    expect(h.run("rollback.sh").code).toBe(2);
    expect(h.calls()).toEqual([]);
  });

  test("a failing health check exits 1 and leaves the state as it was", () => {
    h.writeState({ ...stateV010, pending: "v0.1.1" });
    h.setSwitch("curl-fail");
    const result = h.run("rollback.sh");
    expect(result.code).toBe(1);
    expect(result.output).toContain("rollback failed at verify");
    expect(h.state()).toEqual({ ...stateV010, pending: "v0.1.1" });
  });

  test("a pre-* target passes the verify with `dev`, and a stamped release fails it", () => {
    h.writeState({
      current: "v0.1.0",
      current_commit: "commit-v0.1.0",
      previous: "pre-v0.1.0",
      previous_commit: "commit-head",
    });
    expect(h.run("rollback.sh", [], { STUB_SERVER_RELEASE: "v0.1.0" }).code).toBe(1);
    expect(h.state()?.current).toBe("v0.1.0");
    expect(h.run("rollback.sh", [], { STUB_SERVER_RELEASE: "dev" }).code).toBe(0);
    expect(h.state()?.current).toBe("pre-v0.1.0");
  });

  test("a tag target fails the verify when the server reports another release", () => {
    h.writeState({ ...stateV010, pending: "v0.1.1" });
    const result = h.run("rollback.sh", [], { STUB_SERVER_RELEASE: "v0.1.1" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("expected 'v0.1.0'");
    expect(h.state()?.pending).toBe("v0.1.1");
  });

  test("16. the calls hold no db:migrate, no db:rollback and no build", () => {
    h.writeState({ ...stateV010, pending: "v0.1.1" });
    expect(h.run("rollback.sh").code).toBe(0);
    const calls = h.calls();
    expect(calls.some((line) => line.includes("db:migrate") || line.includes("db:rollback"))).toBe(false);
    expect(calls.some((line) => /(^| )(build|--build)( |$)/.test(line))).toBe(false);
  });
});
