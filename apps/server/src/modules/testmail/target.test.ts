import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadRemoteTarget } from "./target";

const committed = resolve(import.meta.dir, "../../../../../evals/testmail/target.json");
const valid = {
  testAddress: "boss@interia.test",
  host: "home_vm",
  remoteDir: "~/email_assistant",
  composeArgs: "-f deploy/compose.yaml --env-file .env",
  orgId: "ac6ed6a2-ee37-461f-9632-cc08cf549e40",
  mailboxId: "8bc7f572-a7f5-4fa5-aaab-db16dc663e96",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testmail-target-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function load(override: Record<string, unknown>) {
  const file = join(dir, "target.json");
  writeFileSync(file, JSON.stringify({ ...valid, ...override }));
  return loadRemoteTarget(file);
}

describe("loadRemoteTarget", () => {
  test("the committed file parses", () => {
    expect(loadRemoteTarget(committed).host).toBe("home_vm");
  });

  test("a valid file parses", () => {
    expect(load({}).testAddress).toBe("boss@interia.test");
  });

  test.each([
    ["host", "-oProxyCommand=x"],
    ["host", "home_vm; rm -rf /"],
    ["remoteDir", "~/x && curl"],
    ["remoteDir", "~/../etc"],
    ["extra", "field"],
  ])("%s = %s throws without the value in the message", (key, value) => {
    expect(() => load({ [key]: value })).toThrow();
    try {
      load({ [key]: value });
    } catch (error) {
      expect((error as Error).message).not.toContain(value);
    }
  });

  test("a missing file throws file not found", () => {
    expect(() => loadRemoteTarget(join(dir, "none.json"))).toThrow("file not found");
  });
});
