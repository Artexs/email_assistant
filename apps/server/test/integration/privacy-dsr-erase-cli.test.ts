import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { insertAction } from "./fixtures";
import { testDb } from "./helpers";
import { unique, makeDsrKit } from "./privacy-dsr-erase-helpers";

// The `org:dsr --erase` CLI. The seed is committed (the CLI runs in its own process);
// `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-dsr.ts");

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

const { seedOrg, snapshot, count, eraseAudit, cleanup } = makeDsrKit(db);

afterEach(cleanup);

afterAll(async () => {
  await db.destroy();
});

describe("org:dsr --erase CLI", () => {
  test("exit 0 and the count lines; stdout and stderr hold no address or name; the record line is there", async () => {
    const w = await seedOrg(unique());
    const result = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--confirm", w.person]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toContain("erased mails 2");
    expect(lines).toContain("tombstones 2");
    expect(lines).toContain("chain actions 3");
    expect(lines).toContain("chain delegations 1");
    expect(lines).toContain("scrubbed emails.to_addresses 1");
    expect(lines).toContain("scrubbed email_headers.attachments 1");
    expect(lines).toContain("blanked outbox 0");
    expect(lines).toContain("dropped outbox 0");
    expect(lines).toContain("kept delegates 1");
    expect(lines).toContain("kept sender_rules 1");
    expect(lines.at(-1)).toMatch(new RegExp(`^record: dsr erase ${w.orgId} \\d{4}-\\d{2}-\\d{2}$`));
    for (const needle of [w.person, w.orgName, w.own, w.ownerEmail, "@"]) {
      expect(result.stdout + result.stderr).not.toContain(needle);
    }
    expect(await eraseAudit(w.orgId)).toHaveLength(1);
  });

  test("an open action: open action <id>, org_dsr_refused, exit 1, nothing changes", async () => {
    const w = await seedOrg(unique());
    const open = await db.transaction().execute((trx) =>
      insertAction(trx, { orgId: w.orgId }, w.k2, {
        type: "send",
        status: "awaiting_approval",
        payload: { to: [w.person] },
      })
    );
    const before = await snapshot(w.orgId);
    const result = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--confirm", w.person]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`open action ${open}`);
    expect(result.stdout + result.stderr).toContain("org_dsr_refused");
    expect(result.stdout + result.stderr).toContain("open_actions");
    expect(result.stdout + result.stderr).not.toContain(w.person);
    expect(await snapshot(w.orgId)).toEqual(before);
  });

  test("a refusal, a missing confirm and both modes: exit 1 or 2, no address in the output", async () => {
    const w = await seedOrg(unique());
    const mismatch = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--confirm", `x${w.person}`]);
    expect(mismatch.code).toBe(1);
    expect(mismatch.stdout + mismatch.stderr).toContain("confirm_mismatch");
    expect(mismatch.stdout + mismatch.stderr).not.toContain(w.person);
    const noConfirm = await run(["--org-id", w.orgId, "--address", w.person, "--erase"]);
    expect(noConfirm.code).toBe(2);
    expect(noConfirm.stderr).toContain("usage: bun run org:dsr");
    expect(noConfirm.stderr).not.toContain(w.person);
    const both = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--find", "--confirm", w.person]);
    expect(both.code).toBe(2);
    const confirmWithFind = await run(["--org-id", w.orgId, "--address", w.person, "--find", "--confirm", w.person]);
    expect(confirmWithFind.code).toBe(2);
    expect(await count("emails", w.orgId)).toBe(4);
    expect(await eraseAudit(w.orgId)).toHaveLength(0);
  });
});
