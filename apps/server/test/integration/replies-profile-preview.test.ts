import { randomUUID } from "node:crypto";

import { profilePreviewSchema, SAMPLE_MAIL, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { createStylePreview, PREVIEW_DAILY_LIMIT, replyRoutes, type StylePreview } from "../../src/modules/replies";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { LlmHardError, LlmSoftError } from "../../src/platform/llm";

import { insertTriaged, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { CLEAN_ANSWER, fakeLlm, type FakeLlm } from "./reply-job-fixtures";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// POST /api/mailboxes/:id/profile/preview. One drafter call on a fixed sample mail, with a fake model. Committed
// rows; the cleanup deletes both organizations.
const db = testDb();
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const CANARY = "CANARY-real-mail-text";

const orgs: WebOrg[] = [];

beforeEach(() => {
  configureFeatures({ off: [] });
});

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string): Promise<string> {
  const id = randomUUID();
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address: `preview-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  await insertInboxFolder(db, { orgId }, id);
  await insertDefaultSettings(db, { orgId }, id);
  return id;
}

interface SetupOpts {
  flag?: boolean;
  dailyCap?: number;
  locale?: "pl" | "en";
  script?: Parameters<typeof fakeLlm>[0];
  noPreview?: boolean;
  realMail?: boolean;
}

async function setup(opts: SetupOpts = {}) {
  const org = await webOrg(db);
  orgs.push(org);
  const ctx = { orgId: org.orgId };
  if (opts.flag ?? true) {
    await setOrgFeature(db, ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: new Date() });
  }
  if (opts.locale !== undefined) {
    await db.updateTable("users").set({ locale: opts.locale }).where("id", "=", org.ownerId).execute();
  }
  const mine = await addMailbox(org.orgId);
  const foreign = await addMailbox(org.otherOrgId);
  const fake: FakeLlm = fakeLlm(opts.script ?? (() => CLEAN_ANSWER));
  const preview: StylePreview | null =
    opts.noPreview === true
      ? null
      : createStylePreview({
          db,
          llm: fake.llm,
          realMail: opts.realMail ?? true,
          dailyCap: opts.dailyCap ?? 300,
          now: () => new Date(),
        });
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", replyRoutes({ db, preview })),
  });
  const post = (id: string, body: unknown = {}, who = "owner") =>
    app.request(`/api/mailboxes/${id}/profile/preview`, as(who, { method: "POST", body }));
  return { org, ctx, app, mine, foreign, fake, post };
}

async function previewRows(orgId: string) {
  return db
    .selectFrom("audit_log")
    .select(["email_id", "reason_code", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "llm.call")
    .orderBy("id")
    .execute();
}

describe("POST /api/mailboxes/:id/profile/preview", () => {
  test("0. a provider without a sub-processor row (realMail false): no call, no profile leaves, no llm.call row, the answer is llm_off", async () => {
    const { org, mine, fake, post } = await setup({ realMail: false });
    const res = await post(mine, { displayName: "Anna Nowak", signature: "Anna", writingStyle: "Krótko i ciepło." });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "failed", reason: "llm_off" });
    expect(fake.requests).toHaveLength(0);
    expect(await previewRows(org.orgId)).toHaveLength(0);
    // A bad value is still an answer of the card (400), the same as with a real-mail provider.
    expect((await post(mine, { displayName: "a@b" })).status).toBe(400);
  });

  test("1. a fake model: the answer is a body, one llm.call row with no email_id, nothing is stored and no real mail is sent", async () => {
    const { org, ctx, mine, fake, post } = await setup();
    // A real mail in the mailbox: the preview never reads it.
    await db.transaction().execute(async (trx) => {
      const emailId = await insertTriaged(trx, ctx, mine, {
        category: "needs_reply",
        subject: CANARY,
        receivedAt: new Date(),
        createdAt: new Date(),
      });
      await trx.updateTable("emails").set({ body_text: CANARY }).where("id", "=", emailId).execute();
    });

    const res = await post(mine, {
      displayName: "Anna Nowak",
      signature: "Pozdrawiam,\nAnna",
      writingStyle: "Krótko i ciepło.",
    });

    expect(res.status).toBe(200);
    expect(profilePreviewSchema.parse(await res.json())).toEqual({ body: CLEAN_ANSWER.body });
    expect(fake.requests).toHaveLength(1);
    const prompt = `${fake.requests[0]?.system}\n${fake.requests[0]?.prompt}`;
    // The sample mail of the owner's language (no locale reads as Polish) and the unsaved values are in the call.
    expect(prompt).toContain(SAMPLE_MAIL.pl.subject);
    expect(prompt).toContain("Anna Nowak");
    expect(prompt).toContain("Krótko i ciepło.");
    expect(prompt).not.toContain(CANARY);
    const rows = await previewRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email_id: null,
      reason_code: "ok",
      data: { mailbox_id: mine, role: "drafter", prompt_version: "drafter-v4" },
    });
    // Nothing is saved: no profile row, no request, no draft.
    const counts = await Promise.all(
      (["mailbox_profiles", "reply_requests", "actions"] as const).map((table) =>
        db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("org_id", "=", org.orgId)
          .executeTakeFirstOrThrow()
      )
    );
    expect(counts.map((row) => Number(row.n))).toEqual([0, 0, 0]);
  });

  test("the unsaved values replace the stored ones for the call only; a key that is left out keeps the stored value; an empty string takes the fallback", async () => {
    const { org, mine, fake, post } = await setup();
    await db
      .insertInto("mailbox_profiles")
      .values({
        mailbox_id: mine,
        org_id: org.orgId,
        display_name: "Stored Name",
        signature: "Stored Signature",
        writing_style: "Stored style",
      })
      .execute();

    await post(mine, { displayName: "Typed Name" });
    await post(mine, { signature: "" });

    const [first, second] = fake.requests.map((request) => request.prompt);
    expect(first).toContain("Typed Name");
    expect(first).toContain("Stored Signature");
    expect(first).toContain("Stored style");
    expect(first).not.toContain("Stored Name");
    expect(second).toContain("Stored Name");
    expect(second).not.toContain("Stored Signature");
    // The fallback signature of an organization that has no style text is the owner name.
    expect(second).toContain("Owner");
    const stored = await db
      .selectFrom("mailbox_profiles")
      .selectAll()
      .where("mailbox_id", "=", mine)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({
      display_name: "Stored Name",
      signature: "Stored Signature",
      writing_style: "Stored style",
    });
  });

  test("an owner with the locale en gets the English sample mail", async () => {
    const { mine, fake, post } = await setup({
      locale: "en",
      script: () => ({ ...CLEAN_ANSWER, language: "en", body: "Hello,\n\nYes, Tuesday works." }),
    });

    const res = await post(mine);

    expect(await res.json()).toEqual({ body: "Hello,\n\nYes, Tuesday works." });
    expect(fake.requests[0]?.prompt).toContain(SAMPLE_MAIL.en.subject);
    expect(fake.requests[0]?.prompt).not.toContain(SAMPLE_MAIL.pl.subject);
  });

  test("2. the 11th preview of the day is 429 preview_limit and makes no call", async () => {
    const { org, mine, fake, post } = await setup();
    for (let i = 0; i < PREVIEW_DAILY_LIMIT; i += 1) expect((await post(mine)).status).toBe(200);
    expect(fake.requests).toHaveLength(PREVIEW_DAILY_LIMIT);

    const eleventh = await post(mine);

    expect({ status: eleventh.status, body: await eleventh.json() }).toEqual({
      status: 429,
      body: { error: "preview_limit" },
    });
    expect(fake.requests).toHaveLength(PREVIEW_DAILY_LIMIT);
    expect(await previewRows(org.orgId)).toHaveLength(PREVIEW_DAILY_LIMIT);
  });

  test("the limit is per mailbox and per day: another mailbox of the org still previews, and rows of the day before do not count", async () => {
    const { org, mine, fake, post } = await setup();
    const second = await addMailbox(org.orgId);
    const yesterday = new Date(Date.now() - 30 * HOUR_MS);
    for (let i = 0; i < PREVIEW_DAILY_LIMIT; i += 1) {
      await db
        .insertInto("audit_log")
        .values({
          org_id: org.orgId,
          actor: "system",
          event: "llm.call",
          reason_code: "ok",
          data: JSON.stringify({ mailbox_id: mine, role: "drafter", prompt_version: "drafter-v4" }),
          created_at: yesterday,
        })
        .execute();
    }
    expect((await post(mine)).status).toBe(200);
    for (let i = 1; i < PREVIEW_DAILY_LIMIT; i += 1) await post(mine);
    expect((await post(mine)).status).toBe(429);
    expect((await post(second)).status).toBe(200);
    expect(fake.requests.length).toBe(PREVIEW_DAILY_LIMIT + 1);
  });

  test("calls of real mail (a row with an email_id) do not count against the preview limit", async () => {
    const { org, ctx, mine, post } = await setup();
    const emailId = await db
      .transaction()
      .execute((trx) =>
        insertTriaged(trx, ctx, mine, { category: "needs_reply", receivedAt: new Date(), createdAt: new Date() })
      );
    for (let i = 0; i < PREVIEW_DAILY_LIMIT; i += 1) {
      await db
        .insertInto("audit_log")
        .values({
          org_id: org.orgId,
          email_id: emailId,
          actor: "system",
          event: "llm.call",
          reason_code: "ok",
          data: JSON.stringify({ mailbox_id: mine, role: "drafter", prompt_version: "drafter-v4" }),
        })
        .execute();
    }
    expect((await post(mine)).status).toBe(200);
  });

  test("3. a member gets 403 and no call; an owner gets 404 for an unknown id and for a mailbox of another organization", async () => {
    const { mine, foreign, fake, post } = await setup();
    for (const id of [mine, foreign, UNKNOWN]) {
      const res = await post(id, {}, "assistant");
      expect({ id, status: res.status, body: await res.json() }).toEqual({
        id,
        status: 403,
        body: { error: "owner_only" },
      });
    }
    for (const id of [foreign, UNKNOWN, "not-a-uuid"]) {
      const res = await post(id);
      expect({ id, status: res.status, body: await res.json() }).toEqual({
        id,
        status: 404,
        body: { error: "not_found" },
      });
    }
    expect(fake.requests).toEqual([]);
  });

  test("the flag reply_drafts off hides the preview: 404 and no call", async () => {
    const { mine, fake, post } = await setup({ flag: false });
    const res = await post(mine);
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    expect(fake.requests).toEqual([]);
  });

  test("an unsafe name or a text that is too long is 400 validation and makes no call and no row", async () => {
    const { org, mine, fake, post } = await setup();
    for (const body of [
      { displayName: "A <x@y>" },
      { signature: "s".repeat(1001) },
      { writingStyle: "w".repeat(1001) },
    ]) {
      const res = await post(mine, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "validation" });
    }
    expect(fake.requests).toEqual([]);
    expect(await previewRows(org.orgId)).toEqual([]);
  });

  test("a draft that fails a check is 200 failed / checks after the retry, with one row for each call", async () => {
    const { org, mine, fake, post } = await setup({
      script: () => ({ ...CLEAN_ANSWER, body: "Dzień dobry,\n\nZajrzyj na https://evil.example/login" }),
    });

    const res = await post(mine);

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 200,
      body: { kind: "failed", reason: "checks" },
    });
    expect(fake.requests).toHaveLength(2);
    expect(await previewRows(org.orgId)).toHaveLength(2);
  });

  test("a model that says no_draft is 200 failed / no_draft; a provider error is 200 failed with its code and one row", async () => {
    const noDraft = await setup({
      script: () => ({ decision: "no_draft", reason_code: "needs_facts", body: "", gaps: [], language: "pl" }),
    });
    const first = await noDraft.post(noDraft.mine);
    expect(await first.json()).toEqual({ kind: "failed", reason: "no_draft" });

    const broken = await setup({ script: () => new LlmHardError("http_400", "fake-drafter") });
    const second = await broken.post(broken.mine);
    expect(second.status).toBe(200);
    const body = (await second.json()) as { kind: string; reason: string };
    expect(body.kind).toBe("failed");
    expect(body.reason).toBe("http_400");
    expect(await previewRows(broken.org.orgId)).toHaveLength(1);

    const soft = await setup({ script: () => new LlmSoftError("http_429", "fake-drafter") });
    expect(((await (await soft.post(soft.mine)).json()) as { kind: string }).kind).toBe("failed");
  });

  test("it counts in the daily cap like a tap: it is not held at 80 %, and at 100% the preview is failed / llm_cap with no call", async () => {
    const { org, mine, fake, post } = await setup({ dailyCap: 5 });
    // The fifth call starts at 80 % (4 of 5): an automatic draft would wait, a tap does not.
    for (let i = 0; i < 5; i += 1) expect(await (await post(mine)).json()).toEqual({ body: CLEAN_ANSWER.body });
    expect(fake.requests).toHaveLength(5);

    const full = await post(mine);

    expect({ status: full.status, body: await full.json() }).toEqual({
      status: 200,
      body: { kind: "failed", reason: "llm_cap" },
    });
    expect(fake.requests).toHaveLength(5);
    expect(await previewRows(org.orgId)).toHaveLength(5);
  });

  test("a second preview of the same mailbox at the same time is 429 preview_busy, so a burst cannot pass the limit", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { mine, fake, post } = await setup({
      script: async () => {
        await gate;
        return CLEAN_ANSWER;
      },
    });

    const first = post(mine);
    await Bun.sleep(100);
    const second = await post(mine);
    release();

    expect({ status: second.status, body: await second.json() }).toEqual({
      status: 429,
      body: { error: "preview_busy" },
    });
    expect((await first).status).toBe(200);
    expect(fake.requests).toHaveLength(1);
    // The mailbox is free again.
    expect((await post(mine)).status).toBe(200);
  });

  test("no model client (the LLM scope is off): 200 failed / llm_off", async () => {
    const { mine, post } = await setup({ noPreview: true });
    const res = await post(mine);
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 200,
      body: { kind: "failed", reason: "llm_off" },
    });
  });
});
