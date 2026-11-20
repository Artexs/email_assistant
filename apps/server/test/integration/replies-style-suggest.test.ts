import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import {
  sql,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type Transaction,
  type UnknownRow,
} from "kysely";

import { recordLlmCall } from "../../src/modules/audit";
import { writeSentSwitch } from "../../src/modules/mail/repo";
import { createStyleSuggestion, type StyleSuggestDeps } from "../../src/modules/replies";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";
import { LlmHardError } from "../../src/platform/llm";

import { testDb, withRollback } from "./helpers";
import { newOrg, type Org } from "./mail-sent-fixtures";
import { fakeLlm } from "./reply-job-fixtures";
import { addSent, NOW, syntheticId, type SentOpts } from "./style-sent-fixtures";

// The service behind the owner route of the style suggestion: gates, limits, one `stylist` call with a fake model, the checks and
// the records. Every test rolls back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const CLEAN = {
  style:
    "Zwraca się do ludzi po imieniu i pisze krótko. Zaczyna od prostego powitania i kończy krótkim pozdrowieniem. Ton jest rzeczowy i spokojny.",
};
const WITH_NAME = {
  style: "Pisze krótko i zwraca się do ludzi, na przykład do pani Kowalskiej. Ton jest rzeczowy i spokojny.",
};
const WITH_PHONE = { style: "Pisze krótko, a na końcu podaje numer +48 600 700 800 do kontaktu. Ton jest rzeczowy." };

const BY = { userId: "00000000-0000-4000-8000-0000000000aa", language: "pl" as const };

async function addSources(trx: Transaction<DB>, org: Org, count: number, extra: SentOpts = {}): Promise<void> {
  for (let n = 0; n < count; n += 1) await addSent(trx, org.ctx, org.mailboxId, { order: n, ...extra });
}

type Script = Parameters<typeof fakeLlm>[0];

function setup(trx: Transaction<DB>, over: Partial<StyleSuggestDeps> = {}, script: Script = () => CLEAN) {
  const fake = fakeLlm(script);
  const suggest = createStyleSuggestion({
    db: trx,
    llm: fake.llm,
    dailyCap: 300,
    now: () => NOW,
    realMail: true,
    scope: { kind: "all" },
    ...over,
  });
  return { fake, suggest };
}

async function auditRows(trx: Transaction<DB>, ctx: TenantContext, event: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "reason_code", "email_id", "data"])
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", event)
    .orderBy("id")
    .execute();
}

async function outcomesOf(trx: Transaction<DB>, ctx: TenantContext): Promise<string[]> {
  const rows = await trx
    .selectFrom("audit_log")
    .select(sql<string>`data->>'outcome'`.as("outcome"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", "mailbox.style_suggested")
    .orderBy("id")
    .execute();
  return rows.map((row) => row.outcome);
}

const callRows = (trx: Transaction<DB>, ctx: TenantContext) => auditRows(trx, ctx, "llm.call");
const runRows = (trx: Transaction<DB>, ctx: TenantContext) => auditRows(trx, ctx, "mailbox.style_suggested");

describe("createStyleSuggestion", () => {
  test("6 good sources and a clean answer: a suggestion with count 6, one stylist call row with no mail and one audit row with no text", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const { suggest, fake } = setup(trx);

      const result = await suggest(org.ctx, org.mailboxId, BY);

      expect(result).toEqual({ kind: "suggestion", text: CLEAN.style, count: 6 });
      expect(fake.requests).toHaveLength(1);
      const calls = await callRows(trx, org.ctx);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.email_id).toBeNull();
      expect(calls[0]?.data).toMatchObject({
        role: "stylist",
        prompt_version: "stylist-v1",
        mailbox_id: org.mailboxId,
      });
      const runs = await runRows(trx, org.ctx);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.actor).toBe(BY.userId);
      expect(runs[0]?.data).toEqual({ mailbox_id: org.mailboxId, count: 6, outcome: "suggestion", via: "web" });
    });
  });

  test("4 sources: too_few with count 4, no call and no llm.call row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 4);
      const { suggest, fake } = setup(trx);

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "too_few", count: 4 });

      expect(fake.requests).toHaveLength(0);
      expect(await callRows(trx, org.ctx)).toHaveLength(0);
      expect((await runRows(trx, org.ctx)).map((row) => row.data)).toEqual([
        { mailbox_id: org.mailboxId, count: 4, outcome: "too_few", via: "web" },
      ]);
    });
  });

  test("an answer with a recipient first name, then a clean one: a suggestion after 2 calls; the retry prompt names the code and not the text", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6, { to: ["anna.kowalska@client.test"] });
      const { suggest, fake } = setup(trx, {}, (call) => (call === 1 ? WITH_NAME : CLEAN));

      const result = await suggest(org.ctx, org.mailboxId, BY);

      expect(result).toEqual({ kind: "suggestion", text: CLEAN.style, count: 6 });
      expect(await callRows(trx, org.ctx)).toHaveLength(2);
      const retry = fake.requests[1]?.prompt ?? "";
      expect(retry).toContain("- name: ");
      expect(retry).not.toContain("przykład");
    });
  });

  test("a phone number in both answers: failed with checks after 2 calls", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const { suggest } = setup(trx, {}, () => WITH_PHONE);

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "failed", reason: "checks" });

      expect(await callRows(trx, org.ctx)).toHaveLength(2);
      expect(await outcomesOf(trx, org.ctx)).toEqual(["checks"]);
    });
  });

  test("an answer that breaks the schema twice: failed with output and 2 rows with the code bad_output", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const { suggest } = setup(trx, {}, () => ({}));

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "failed", reason: "output" });

      expect((await callRows(trx, org.ctx)).map((row) => row.reason_code)).toEqual(["bad_output", "bad_output"]);
    });
  });

  test("a provider error: failed with provider, one failed call row and an audit row with outcome provider", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const { suggest } = setup(trx, {}, () => new LlmHardError("http_401", "fake"));

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "failed", reason: "provider" });

      expect(await callRows(trx, org.ctx)).toHaveLength(1);
      expect(await outcomesOf(trx, org.ctx)).toEqual(["provider"]);
    });
  });

  test("the switch turned off during the call: sent_off, the text is dropped and the audit outcome is sent_off", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const { suggest } = setup(trx, {}, async () => {
        await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
        return CLEAN;
      });

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "sent_off" });

      expect(await callRows(trx, org.ctx)).toHaveLength(1);
      expect((await runRows(trx, org.ctx)).map((row) => row.data)).toEqual([
        { mailbox_id: org.mailboxId, count: 6, outcome: "sent_off", via: "web" },
      ]);
    });
  });

  test("three runs with a call, then a fourth: limit, with no new row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const { suggest, fake } = setup(trx);

      for (let run = 0; run < 3; run += 1) expect((await suggest(org.ctx, org.mailboxId, BY)).kind).toBe("suggestion");
      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "limit" });

      expect(fake.requests).toHaveLength(3);
      expect(await runRows(trx, org.ctx)).toHaveLength(3);
    });
  });

  test("two runs at once: one suggestion and one busy", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const { suggest } = setup(trx);

      const results = await Promise.all([suggest(org.ctx, org.mailboxId, BY), suggest(org.ctx, org.mailboxId, BY)]);

      expect(results.map((result) => result.kind).sort()).toEqual(["busy", "suggestion"]);
    });
  });

  test("three too_few answers do not count: a run with enough mail afterwards makes the call", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 4);
      const { suggest, fake } = setup(trx);
      for (let run = 0; run < 3; run += 1) expect((await suggest(org.ctx, org.mailboxId, BY)).kind).toBe("too_few");
      await addSent(trx, org.ctx, org.mailboxId, { order: 10 });
      await addSent(trx, org.ctx, org.mailboxId, { order: 11 });

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "suggestion", text: CLEAN.style, count: 6 });

      expect(fake.requests).toHaveLength(1);
    });
  });

  test("the daily cap used up: failed with llm_cap and no call", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      for (let n = 0; n < 2; n += 1) {
        await recordLlmCall(trx, org.ctx, {
          mailboxId: org.mailboxId,
          role: "classifier",
          promptVersion: "classifier-v4",
          model: "fake",
          endpoint: "standard",
          provider: "openai",
          outcome: "ok",
          tokensIn: 1,
          tokensOut: 1,
          latencyMs: 1,
          at: new Date(NOW.getTime() - HOUR_MS),
        });
      }
      const { suggest, fake } = setup(trx, { dailyCap: 2 });

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "failed", reason: "llm_cap" });

      expect(fake.requests).toHaveLength(0);
      expect(await outcomesOf(trx, org.ctx)).toEqual(["llm_cap"]);
    });
  });

  test("a provider with no sub-processor row (realMail false): failed with llm_off and no query on the sent mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const off = spy(trx);
      const { suggest, fake } = setup(off.db, { realMail: false });

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "failed", reason: "llm_off" });

      expect(fake.requests).toHaveLength(0);
      expect(off.touched("sent_emails")).toBe(false);
      // The same spy sees the read when the provider may get real mail.
      const on = spy(trx);
      await setup(on.db).suggest(org.ctx, org.mailboxId, BY);
      expect(on.touched("sent_emails")).toBe(true);
    });
  });

  test("the prompt holds the texts and nothing else of the mails: no subject, no address", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6, {
        subject: "SUBJECT-CANARY",
        to: ["canary.person@client.test"],
        cc: ["cc@cc.test"],
      });
      const { suggest, fake } = setup(trx);

      await suggest(org.ctx, org.mailboxId, BY);

      const prompt = `${fake.requests[0]?.system}\n${fake.requests[0]?.prompt}`;
      expect(prompt).toContain("Tak, wtorek mi pasuje.");
      for (const secret of ["SUBJECT-CANARY", "client.test", "canary.person", "cc.test", "me@corp.test"]) {
        expect(prompt).not.toContain(secret);
      }
    });
  });

  test.each([
    ["en", "English (en)", { style: "Writes short and plain mails and greets people by the first name." }],
    ["pl", "Polish (pl)", CLEAN],
    [null, "Polish (pl)", CLEAN],
  ] as const)("the panel language %p asks for the answer in %p", async (language, line, answer) => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 5);
      const { suggest, fake } = setup(trx, {}, () => answer);

      await suggest(org.ctx, org.mailboxId, { userId: BY.userId, language });

      expect(fake.requests[0]?.prompt).toContain(`- Write the description in: ${line}`);
    });
  });

  test("under the synthetic scope only test mail is read", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      const { suggest } = setup(trx, { scope: { kind: "synthetic", testMail: { senders: [] } } });
      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "too_few", count: 0 });

      for (let n = 0; n < 5; n += 1) await addSent(trx, org.ctx, org.mailboxId, { order: n, messageId: syntheticId() });

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "suggestion", text: CLEAN.style, count: 5 });
    });
  });
});

describe("the guards of createStyleSuggestion", () => {
  test("a mailbox of another organization: not_found, no read, no row", async () => {
    await withRollback(db, async (trx) => {
      const mine = await newOrg(trx);
      const foreign = await newOrg(trx);
      await addSources(trx, foreign, 6);
      const { suggest, fake } = setup(trx);

      expect(await suggest(mine.ctx, foreign.mailboxId, BY)).toEqual({ kind: "not_found" });

      expect(fake.requests).toHaveLength(0);
      expect(await runRows(trx, mine.ctx)).toHaveLength(0);
    });
  });

  test("a mailbox with an OAuth login: blocked and no row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await addSources(trx, org, 6);
      await trx.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", org.mailboxId).execute();
      const { suggest } = setup(trx);

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "blocked", reason: "oauth_mailbox" });

      expect(await runRows(trx, org.ctx)).toHaveLength(0);
    });
  });

  test.each([
    ["the flag sent_sync is off", false, true],
    ["the switch of the mailbox is off", true, false],
  ])("%s: sent_off, no call and an audit row", async (_label, flag, switchOn) => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { flag, switchOn });
      await addSources(trx, org, 6);
      const { suggest, fake } = setup(trx);

      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "sent_off" });

      expect(fake.requests).toHaveLength(0);
      expect(await outcomesOf(trx, org.ctx)).toEqual(["sent_off"]);
    });
  });

  test("the flag sent_sync turned on again opens the gate", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { flag: false });
      await addSources(trx, org, 6);
      const { suggest } = setup(trx);
      expect(await suggest(org.ctx, org.mailboxId, BY)).toEqual({ kind: "sent_off" });

      await upsertOrgFeature(trx, org.ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });

      expect((await suggest(org.ctx, org.mailboxId, BY)).kind).toBe("suggestion");
    });
  });
});

// A database handle that records which tables its queries name. The plugin sees the query tree before it runs.
function spy(trx: Transaction<DB>) {
  const trees: string[] = [];
  const plugin: KyselyPlugin = {
    transformQuery: ({ node }: PluginTransformQueryArgs) => {
      trees.push(JSON.stringify(node));
      return node;
    },
    transformResult: async ({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> => result,
  };
  return { db: trx.withPlugin(plugin), touched: (table: string) => trees.some((tree) => tree.includes(`"${table}"`)) };
}
