import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Batch, PersonaFile } from "@ea/core";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { startFakeAgentMail, type FakeAgentMail } from "../../src/modules/testmail/agentmail/fake";

// Every spawned CLI runs in a new temp folder, against the fake server, with TESTMAIL_ROOT in that folder:
// never the real AgentMail API, never ~/.local/state/ea-testmail.
const script = resolve(import.meta.dir, "../../src/scripts/testmail.ts");
const apiKey = "k-test-secret-1234567890";
const testAddress = "boss@interia.test";
const batchId = "2026-11-08-cli";

const personas: PersonaFile = {
  inbox: { username: "ea-cli", clientId: "ea-cli-client", defaultDisplayName: "Default Name" },
  personas: [
    { key: "anna", displayName: "Anna Kowalska", group: "work", lang: "pl", voice: "calm" },
    { key: "jan", displayName: "Jan Nowak", group: "work", lang: "pl", voice: "short" },
  ],
};

const target = {
  testAddress,
  host: "home_vm",
  remoteDir: "~/email_assistant",
  composeArgs: "-f deploy/compose.yaml --env-file .env",
  orgId: "ac6ed6a2-ee37-461f-9632-cc08cf549e40",
  mailboxId: "8bc7f572-a7f5-4fa5-aaab-db16dc663e96",
};

function makeBatch(overrides: { blind?: boolean; disagree?: boolean } = {}): Batch {
  const blind = overrides.blind ?? true;
  const withBlind = (category: "info" | "spam") => (blind ? { blind: { category } } : {});
  return {
    batch: batchId,
    writer: "test",
    cases: [
      {
        id: "a",
        persona: "anna",
        lang: "pl",
        subject: "Subjectword a",
        body: "Bodyword a",
        expected: { category: "info" },
        ...withBlind(overrides.disagree ? "spam" : "info"),
      },
      {
        id: "b",
        persona: "jan",
        lang: "pl",
        subject: "Subjectword b",
        body: "Bodyword b",
        expected: { category: "info" },
        ...withBlind("info"),
      },
    ],
  };
}

let root: string;
let fake: FakeAgentMail;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "testmail-cli-"));
  fake = await startFakeAgentMail({ apiKey });
  writeJson("evals/testmail/personas.json", personas);
  writeJson("evals/testmail/target.json", target);
});

afterEach(async () => {
  await fake.stop();
  rmSync(root, { recursive: true, force: true });
});

function writeJson(relative: string, value: unknown): string {
  const file = join(root, relative);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function writeBatch(batch: Batch): string {
  return writeJson(`evals/testmail/batches/${batch.batch}.json`, batch);
}

const runsDir = () => join(root, "evals/.runs/testmail");
const batchLog = () => join(runsDir(), `${batchId}.jsonl`);

async function cli(
  args: string[],
  env: Record<string, string | undefined> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const merged: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    AGENTMAIL_BASE_URL: fake.baseUrl,
    AGENTMAIL_API_KEY: apiKey,
    TESTMAIL_ROOT: root,
    TEST_MAILBOX_ADDRESS: testAddress,
    ...env,
  };
  const fullEnv = Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  const proc = Bun.spawn([process.execPath, script, ...args], {
    cwd: root,
    env: fullEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function sentLines(): { type: string }[] {
  return readFileSync(batchLog(), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { type: string })
    .filter((line) => line.type === "sent");
}

describe("testmail CLI send guard", () => {
  test("1. without TEST_MAILBOX_ADDRESS send is refused", async () => {
    writeBatch(makeBatch());
    const result = await cli(["send", "--batch", batchId], { TEST_MAILBOX_ADDRESS: undefined });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("send refused");
    expect(fake.requests).toHaveLength(0);
    expect(existsSync(runsDir())).toBe(false);
  });

  test("2. an AgentMail address is refused", async () => {
    writeBatch(makeBatch());
    const result = await cli(["send", "--batch", batchId], { TEST_MAILBOX_ADDRESS: "x@agentmail.to" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("send refused");
    expect(fake.requests).toHaveLength(0);
    expect(existsSync(batchLog())).toBe(false);
    expect(existsSync(join(runsDir(), "send.lock"))).toBe(false);
  });

  test("11. an address that differs from target.json, or is not an address, is refused", async () => {
    writeBatch(makeBatch());
    const other = await cli(["send", "--batch", batchId], { TEST_MAILBOX_ADDRESS: "other@interia.test" });
    expect(other.code).toBe(1);
    expect(other.stderr).toContain("differs from evals/testmail/target.json");
    const wrong = await cli(["send", "--batch", batchId], { TEST_MAILBOX_ADDRESS: "not-an-address" });
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain("send refused");
    expect(fake.requests).toHaveLength(0);
    expect(existsSync(runsDir())).toBe(false);
  });
});

describe("testmail CLI validate and blind", () => {
  test("3. blind_disagrees stops send and fails validate; --allow-unlabelled accepts a batch without blind", async () => {
    writeBatch(makeBatch({ disagree: true }));
    const send = await cli(["send", "--batch", batchId]);
    expect(send.code).toBe(1);
    expect(fake.requests).toHaveLength(0);
    const validate = await cli(["validate", "--batch", batchId]);
    expect(validate.code).toBe(1);
    expect(validate.stdout).toContain("blind_disagrees");

    writeBatch(makeBatch({ blind: false }));
    const unlabelled = await cli(["validate", "--batch", batchId, "--allow-unlabelled"]);
    expect(unlabelled.code).toBe(0);
    expect(unlabelled.stdout).toContain("valid");
  });

  test("validate of a missing batch file prints file not found without a stack trace", async () => {
    const result = await cli(["validate", "--batch", "2026-01-01-x"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("file not found");
    expect(result.stderr).not.toContain("at ");
  });

  test("8. blind prints no expected; --apply writes blind and checker and reports a disagreement", async () => {
    const file = writeBatch(makeBatch({ blind: false }));
    const view = await cli(["blind", "--batch", batchId]);
    expect(view.code).toBe(0);
    expect(view.stdout).not.toContain("expected");
    expect(JSON.parse(view.stdout)).toHaveLength(2);

    const labels = writeJson("labels.json", [
      { id: "a", category: "spam" },
      { id: "b", category: "info" },
    ]);
    const applied = await cli(["blind", "--batch", batchId, "--apply", labels, "--checker", "haiku-test"]);
    expect(applied.code).toBe(0);
    expect(applied.stdout).toContain("disagree a: expected info, blind spam");
    expect(applied.stdout).toContain("agree 1, disagree 1, missing 0, unknown 0");
    const written = JSON.parse(readFileSync(file, "utf8")) as Batch;
    expect(written.checker).toBe("haiku-test");
    expect(written.cases[0]?.blind).toEqual({ category: "spam" });
  });
});

describe("testmail CLI send", () => {
  test("4. --dry-run needs no API key, makes no request and writes no log", async () => {
    writeBatch(makeBatch());
    const result = await cli(["send", "--batch", batchId, "--dry-run"], { AGENTMAIL_API_KEY: undefined });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("would send a attempt 1");
    expect(result.stdout + result.stderr).not.toContain(apiKey);
    expect(fake.requests).toHaveLength(0);
    expect(existsSync(batchLog())).toBe(false);
  });

  test("5 + 6. send sends each case once to the test address; status shows it; a repeat sends nothing", async () => {
    writeBatch(makeBatch());
    expect((await cli(["setup"])).code).toBe(0);
    const first = await cli(["send", "--batch", batchId, "--interval-sec", "5"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("sent 2, recovered 0, failed 0, remaining 0");
    expect(first.stdout + first.stderr).not.toContain(apiKey);
    expect(fake.sent).toHaveLength(2);
    for (const item of fake.sent) expect(item.body.to).toEqual([testAddress]);
    expect(sentLines()).toHaveLength(2);

    const status = await cli(["status", "--batch", batchId]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("a info sent");
    expect(status.stdout).toContain("b info sent");

    const again = await cli(["send", "--batch", batchId, "--interval-sec", "5"]);
    expect(again.code).toBe(0);
    expect(again.stdout + again.stderr).not.toContain(apiKey);
    expect(fake.sent).toHaveLength(2);
    expect(existsSync(join(runsDir(), "send.lock"))).toBe(false);
  }, 20_000);

  test("a TEST_MAILBOX_ADDRESS in other letter case sends to the pinned address", async () => {
    writeBatch(makeBatch());
    expect((await cli(["setup"])).code).toBe(0);
    const result = await cli(["send", "--batch", batchId, "--interval-sec", "5"], {
      TEST_MAILBOX_ADDRESS: testAddress.toUpperCase(),
    });
    expect(result.code).toBe(0);
    expect(fake.sent).toHaveLength(2);
    for (const item of fake.sent) expect(item.body.to).toEqual([testAddress]);
  }, 20_000);

  test("7. a damaged log stops send", async () => {
    writeBatch(makeBatch());
    mkdirSync(runsDir(), { recursive: true });
    writeFileSync(batchLog(), `not json\n{"type":"intent"}\n`);
    const result = await cli(["send", "--batch", batchId]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("send log damaged");
    expect(fake.sent).toHaveLength(0);
  });

  test("10. a live lock stops send", async () => {
    writeBatch(makeBatch());
    mkdirSync(runsDir(), { recursive: true });
    writeFileSync(join(runsDir(), "send.lock"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const result = await cli(["send", "--batch", batchId]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("another testmail send runs");
    expect(fake.sent).toHaveLength(0);
  });
});

describe("testmail CLI setup", () => {
  test("9. setup creates the inbox only on a 404; a second run only reads", async () => {
    const first = await cli(["setup"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("inbox ea-cli@agentmail.to status active status_until 2026-12-07T14:40:11.000Z");
    expect(fake.requests.map((item) => item.method)).toEqual(["GET", "POST", "GET"]);

    fake.requests.length = 0;
    const second = await cli(["setup"]);
    expect(second.code).toBe(0);
    expect(fake.requests.map((item) => item.method)).toEqual(["GET"]);
  });
});
