import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { connectMailbox } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";

import { insertTriaged } from "./fixtures";
import { testDb } from "./helpers";

// Needs the local GreenMail (bun run dev:up) for test 5. The rows are committed: the spawned script cannot see a transaction.
// The script runs with the repo root as cwd (it needs the DB keys and reads no AgentMail key). Keys that a run wants unset are passed as "".
const db = testDb();
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);

const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(repoRoot, "apps/server/src/scripts/testmail-target.ts");
const SENDER = "ea-testmail-75wd@agentmail.to";

let orgId = "";
let userId = "";
let mailboxId = "";
let address = "";

beforeAll(async () => {
  const suffix = randomUUID();
  ({ orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: `Target Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `target-${suffix}@x.test`,
    displayName: "Owner",
  }));
  address = `u-${suffix}@localhost`;
  ({ mailboxId } = await connectMailbox(
    { db, secrets, openProvider: async () => createFakeMailProvider(), verifySmtp: () => Promise.resolve() },
    { orgId },
    {
      address,
      password: `target-pw-${suffix}`,
      secretKind: "password",
      imapHost: host,
      imapPort,
      smtpHost: host,
      smtpPort,
    }
  ));
});

afterAll(async () => {
  if (orgId !== "") {
    await db.deleteFrom("triage_results").where("org_id", "=", orgId).execute();
    await db.deleteFrom("emails").where("org_id", "=", orgId).execute();
    await db.deleteFrom("mailboxes").where("org_id", "=", orgId).execute();
    await db.deleteFrom("organizations").where("id", "=", orgId).execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
    const left = await db
      .selectFrom("emails")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("org_id", "=", orgId)
      .executeTakeFirstOrThrow();
    expect(Number(left.n)).toBe(0);
  }
  await db.destroy();
});

interface TestCase {
  caseId: string;
  expected: string;
  messageId: string | null;
}

function inputOf(cases: TestCase[], batch = "2026-11-08-a") {
  return {
    batch,
    sender: SENDER,
    cases: cases.map((c) => ({
      caseId: c.caseId,
      persona: "anna",
      expected: c.expected,
      marker: "none",
      parentCaseId: null,
      messageId: c.messageId,
      sentAt: c.messageId === null ? null : new Date().toISOString(),
    })),
  };
}

async function run(args: string[], stdin: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TRIAGE_LLM_SCOPE: "off", ACTIONS_SCOPE: "off", ...env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const compareArgs = () => ["compare", "--org-id", orgId, "--mailbox-id", mailboxId];
const deliverArgs = () => ["deliver", "--org-id", orgId, "--mailbox-id", mailboxId];

function newId(label: string): string {
  return `<${label}-${randomUUID()}@t.test>`;
}

async function storeTriaged(messageId: string, category: "info" | "spam", subject: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await insertTriaged(trx, { orgId }, mailboxId, { category, createdAt: new Date(), messageId, subject });
  });
}

describe("testmail-target", () => {
  test("compare: right, wrong and not synced → exit 2, table and synthetic eval report", async () => {
    const right = newId("right");
    const wrong = newId("wrong");
    await storeTriaged(right, "info", "secret-subject-1");
    await storeTriaged(wrong, "info", "secret-subject-2");
    const input = inputOf([
      { caseId: "c-right", expected: "info", messageId: right },
      { caseId: "c-wrong", expected: "spam", messageId: wrong },
      { caseId: "c-gone", expected: "info", messageId: newId("gone") },
    ]);

    const { stdout, code } = await run(compareArgs(), JSON.stringify(input));

    expect(code).toBe(2);
    expect(stdout).toContain("# Testmail compare: 2026-11-08-a");
    expect(stdout).toMatch(/\| ok \|/);
    expect(stdout).toContain("WRONG");
    expect(stdout).toContain("not synced");
    expect(stdout).toContain("prompt versions:");
    expect(stdout).toContain("Eval report: testmail batch 2026-11-08-a");
    expect(stdout).toContain("synthetic mail, dev check");
    expect(stdout).not.toContain("real mails");
    expect(stdout).not.toContain("secret-subject");
  });

  test("compare: all sent cases triaged → exit 0", async () => {
    const first = newId("one");
    const second = newId("two");
    await storeTriaged(first, "info", "secret-subject-3");
    await storeTriaged(second, "spam", "secret-subject-4");
    const input = inputOf([
      { caseId: "c-one", expected: "info", messageId: first },
      { caseId: "c-two", expected: "spam", messageId: second },
      { caseId: "c-unsent", expected: "info", messageId: null },
    ]);

    const { code, stdout } = await run(compareArgs(), JSON.stringify(input));

    expect(code).toBe(0);
    expect(stdout).toContain("not sent");
  });

  test("bad stdin → exit 1, bad input", async () => {
    const { code, stderr, stdout } = await run(compareArgs(), "{}");

    expect(code).toBe(1);
    expect(stderr).toContain("bad input");
    expect(stdout).toBe("");
  });

  test("deliver without TEST_MAILBOX_ADDRESS → exit 1", async () => {
    const input = inputOf([{ caseId: "c-a", expected: "info", messageId: newId("a") }]);

    const { code, stderr } = await run(deliverArgs(), JSON.stringify(input), { TEST_MAILBOX_ADDRESS: "" });

    expect(code).toBe(1);
    expect(stderr).toContain("TEST_MAILBOX_ADDRESS is not set");
  });

  test("deliver: every case already synced → exit 0, only JSON lines on stdout", async () => {
    const ids = [newId("s1"), newId("s2")];
    await storeTriaged(ids[0] as string, "info", "secret-subject-5");
    await storeTriaged(ids[1] as string, "info", "secret-subject-6");
    const input = inputOf([
      { caseId: "c-s1", expected: "info", messageId: ids[0] as string },
      { caseId: "c-s2", expected: "info", messageId: ids[1] as string },
    ]);

    const { code, stdout } = await run(deliverArgs(), JSON.stringify(input), { TEST_MAILBOX_ADDRESS: address });

    expect(code).toBe(0);
    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ result: "synced" });
    expect(stdout).not.toContain("secret-subject");
  });
});
