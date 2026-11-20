import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

// `bun run mailbox:settings urgency`. The profile may name people: the CLI prints counts and Zod
// issue paths, never a label, a keyword or a value. `print` goes to stdout, `fail` to stderr (createCliOutput).
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/mailbox-settings.ts");
const NAME = "mailbox-settings";
const CANARY = "CANARY-VIP-Zofia-Nowak";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "urgency-cli-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await db.destroy();
});

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[]): Promise<Result> {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, MAIL_ALLOW_LOCAL_HOSTS: "true" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function box() {
  return db.transaction().execute(async (trx) => {
    const created = await createOrgWithMailbox(trx);
    await insertDefaultSettings(trx, { orgId: created.orgId }, created.mailboxId);
    return created;
  });
}

async function removeOrg(orgId: string, userId: string): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  await db.deleteFrom("users").where("id", "=", userId).execute();
}

async function fixture(name: string, content: unknown): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

const stored = (mailboxId: string) =>
  db
    .selectFrom("mailbox_settings")
    .select("urgency_profile")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();

describe("mailbox:settings urgency", () => {
  test("--file sets the profile and `show` prints counts; --clear prints `urgency none`; streams are right", async () => {
    const created = await box();
    try {
      const args = ["--org-id", created.orgId, "--mailbox-id", created.mailboxId];
      const none = await run(["show", ...args]);
      expect(none.code).toBe(0);
      expect(none.stdout).toContain(`[${NAME}] urgency none`);

      const file = await fixture("one.json", { topics: [{ label: CANARY, keywords: [CANARY] }], deadlines: [] });
      const set = await run(["urgency", ...args, "--file", file]);
      expect(set.code).toBe(0);
      expect(set.stderr).toBe("");
      expect(set.stdout).toBe(`[${NAME}] urgency topics=1 deadlines=0\n`);
      expect((await stored(created.mailboxId)).urgency_profile).toEqual({
        topics: [{ label: CANARY, keywords: [CANARY] }],
        deadlines: [],
      });

      const show = await run(["show", ...args]);
      expect(show.code).toBe(0);
      expect(show.stdout).toContain(`[${NAME}] urgency topics=1 deadlines=0`);
      expect(show.stdout).not.toContain("CANARY");
      expect(show.stderr).toBe("");

      const same = await run(["urgency", ...args, "--file", file]);
      expect(same.stdout).toBe(`[${NAME}] urgency topics=1 deadlines=0 (no change)\n`);

      const cleared = await run(["urgency", ...args, "--clear"]);
      expect(cleared.code).toBe(0);
      expect(cleared.stderr).toBe("");
      expect(cleared.stdout).toBe(`[${NAME}] urgency none\n`);
      expect((await stored(created.mailboxId)).urgency_profile).toBeNull();
      expect((await run(["show", ...args])).stdout).toContain(`[${NAME}] urgency none`);

      const audit = await db
        .selectFrom("audit_log")
        .select(["actor", "data"])
        .where("org_id", "=", created.orgId)
        .where("event", "=", "settings.urgency_set")
        .orderBy("id")
        .execute();
      expect(audit.map((row) => row.actor)).toEqual(["cli", "cli"]);
      expect(audit.map((row) => row.data)).toEqual([
        { mailbox_id: created.mailboxId, topics: 1, deadlines: 0, via: "cli" },
        { mailbox_id: created.mailboxId, topics: 0, deadlines: 0, via: "cli" },
      ]);
    } finally {
      await removeOrg(created.orgId, created.userId);
    }
  }, 60_000);

  test("a bad file prints the usage and issue paths on stderr, writes nothing, exits 1", async () => {
    const created = await box();
    try {
      const args = ["--org-id", created.orgId, "--mailbox-id", created.mailboxId];
      const notJson = await run(["urgency", ...args, "--file", await fixture("bad.json", `{ ${CANARY}`)]);
      expect(notJson.code).toBe(1);
      expect(notJson.stdout).toBe("");
      expect(notJson.stderr).toContain("usage:");
      expect(notJson.stderr).toContain("urgency file: not JSON");
      expect(notJson.stderr).not.toContain("CANARY");

      const topics = Array.from({ length: 21 }, () => ({ label: CANARY, keywords: [] }));
      const tooMany = await run(["urgency", ...args, "--file", await fixture("many.json", { topics })]);
      expect(tooMany.code).toBe(1);
      expect(tooMany.stdout).toBe("");
      expect(tooMany.stderr).toContain("usage:");
      expect(tooMany.stderr).toContain("urgency file: schema errors at topics");
      expect(tooMany.stderr).not.toContain("CANARY");

      const badDate = await fixture("date.json", { deadlines: [{ label: CANARY, due: `${CANARY}-soon` }] });
      const date = await run(["urgency", ...args, "--file", badDate]);
      expect(date.code).toBe(1);
      expect(date.stderr).toContain("deadlines.0.due");
      expect(date.stderr).not.toContain("CANARY");

      const missing = await run(["urgency", ...args, "--file", join(dir, "missing.json")]);
      expect(missing.code).toBe(1);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).toContain(`[${NAME}] cannot read the urgency file`);

      expect((await stored(created.mailboxId)).urgency_profile).toBeNull();
    } finally {
      await removeOrg(created.orgId, created.userId);
    }
  }, 60_000);

  test("without --file or --clear, or with both: usage on stderr, exit 2", async () => {
    const created = await box();
    try {
      const args = ["--org-id", created.orgId, "--mailbox-id", created.mailboxId];
      const file = await fixture("any.json", { topics: [], deadlines: [] });
      for (const extra of [[], ["--file", file, "--clear"]]) {
        const result = await run(["urgency", ...args, ...extra]);
        expect(result.code).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(`[${NAME}] usage: bun run mailbox:settings show`);
      }
    } finally {
      await removeOrg(created.orgId, created.userId);
    }
  }, 60_000);

  test("another organization: its id with this mailbox fails and changes nothing; each org sets its own", async () => {
    const a = await box();
    const b = await box();
    try {
      const file = await fixture("a.json", { topics: [{ label: "a", keywords: [] }], deadlines: [] });
      const foreign = await run(["urgency", "--org-id", b.orgId, "--mailbox-id", a.mailboxId, "--file", file]);
      expect(foreign.code).toBe(1);
      expect(foreign.stdout).toBe("");
      expect(foreign.stderr).toContain(`[${NAME}] failed:`);
      expect((await stored(a.mailboxId)).urgency_profile).toBeNull();
      expect((await stored(b.mailboxId)).urgency_profile).toBeNull();

      const foreignClear = await run(["urgency", "--org-id", b.orgId, "--mailbox-id", a.mailboxId, "--clear"]);
      expect(foreignClear.code).toBe(1);

      expect((await run(["urgency", "--org-id", a.orgId, "--mailbox-id", a.mailboxId, "--file", file])).code).toBe(0);
      const showB = await run(["show", "--org-id", b.orgId, "--mailbox-id", b.mailboxId]);
      expect(showB.stdout).toContain(`[${NAME}] urgency none`);
      const showForeign = await run(["show", "--org-id", b.orgId, "--mailbox-id", a.mailboxId]);
      expect(showForeign.code).toBe(1);
    } finally {
      await removeOrg(a.orgId, a.userId);
      await removeOrg(b.orgId, b.userId);
    }
  }, 60_000);
});
