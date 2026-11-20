import { randomUUID } from "node:crypto";

import { HOUR_MS, type FeatureKey, styleSuggestionAnswerSchema, styleSuggestionConflictSchema } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";
import { insertInboxFolder, insertMailbox, writeSentSwitch } from "../../src/modules/mail/repo";
import {
  createStyleSuggestion,
  replyRoutes,
  type StyleSuggest,
  type StyleSuggestResult,
} from "../../src/modules/replies";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { captureLogs, eventLines } from "../log-capture";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { fakeLlm } from "./reply-job-fixtures";
import { addSent, NOW } from "./style-sent-fixtures";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// POST /api/mailboxes/:id/profile/style-suggestion: the guards in their order, the map of the service answers to HTTP, and the
// log line of a run. Committed rows; the cleanup deletes both organizations.
const db = testDb();
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const CLEAN = {
  style:
    "Zwraca się do ludzi po imieniu i pisze krótko. Zaczyna od prostego powitania i kończy krótkim pozdrowieniem. Ton jest rzeczowy i spokojny.",
};

// The keys of a JSON log line that are not fields: the base keys and the request context.
const LINE_BASE: ReadonlySet<string> = new Set(["time", "level", "module", "event", "msg", "request_id"]);

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
  const ctx = { orgId };
  await insertMailbox(db, ctx, {
    id,
    address: `suggest-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await insertInboxFolder(db, ctx, id);
  await insertDefaultSettings(db, ctx, id);
  return id;
}

async function setFlags(orgId: string, flags: Partial<Record<FeatureKey, boolean>>): Promise<void> {
  for (const [flag, enabled] of Object.entries(flags)) {
    if (enabled === undefined) continue;
    await setOrgFeature(db, { orgId }, { flag: flag as FeatureKey, enabled, actor: "cli", now: NOW });
  }
}

interface SetupOpts {
  flags?: Partial<Record<FeatureKey, boolean>>;
  // The service behind the route; default: a stub that answers `too_few` and records its calls.
  suggest?: StyleSuggest | null;
}

async function setup(opts: SetupOpts = {}) {
  const org = await webOrg(db);
  orgs.push(org);
  await setFlags(org.orgId, { reply_drafts: true, style_from_sent: true, ...opts.flags });
  await setFlags(org.otherOrgId, { reply_drafts: true, style_from_sent: true, sent_sync: true });
  const mine = await addMailbox(org.orgId);
  const foreign = await addMailbox(org.otherOrgId);
  const calls: { mailboxId: string; userId: string; language: "pl" | "en" | null }[] = [];
  const stub: StyleSuggest = async (_ctx, mailboxId, by) => {
    calls.push({ mailboxId, ...by });
    return { kind: "too_few", count: 0 };
  };
  const suggest = opts.suggest === undefined ? stub : opts.suggest;
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", replyRoutes({ db, preview: null, styleSuggestion: suggest })),
  });
  const url = (id: string) => `/api/mailboxes/${id}/profile/style-suggestion`;
  const post = (id: string, who = "owner", body: unknown = {}) =>
    app.request(url(id), as(who, { method: "POST", body }));
  return { org, mine, foreign, calls, app, post, url };
}

describe("POST /api/mailboxes/:id/profile/style-suggestion", () => {
  test("no session is 401 and the service does not run", async () => {
    const { app, mine, url, calls } = await setup();

    const res = await app.request(url(mine), {
      method: "POST",
      body: "{}",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
    });

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test("a member is 403, also for an id that does not exist", async () => {
    const { mine, post, calls } = await setup();

    expect({ own: (await post(mine, "member")).status, unknown: (await post(UNKNOWN, "member")).status }).toEqual({
      own: 403,
      unknown: 403,
    });
    expect(calls).toHaveLength(0);
  });

  test.each([
    { name: "style_from_sent off", flags: { style_from_sent: false } },
    { name: "reply_drafts off", flags: { reply_drafts: false } },
  ])(
    "$name: 404 for the owner and for a member, also for a bad id, and the service does not run",
    async ({ flags }) => {
      const { mine, post, calls } = await setup({ flags });

      const statuses = await Promise.all(
        [
          post(mine, "owner"),
          post(mine, "member"),
          post(UNKNOWN, "owner"),
          post("not-a-uuid", "member"),
          post(mine, "owner", { x: 1 }),
        ].map(async (pending) => (await pending).status)
      );

      expect(statuses).toEqual([404, 404, 404, 404, 404]);
      expect(calls).toHaveLength(0);
    }
  );

  test("a body with a key is 400 validation and the service does not run", async () => {
    const { mine, post, calls } = await setup();

    const res = await post(mine, "owner", { x: 1 });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation");
    expect(calls).toHaveLength(0);
  });

  test("a bad id is 404 and the service does not run", async () => {
    const { post, calls } = await setup();

    expect((await post("not-a-uuid")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test("the service gets the mailbox, the user of the session and the language of the owner", async () => {
    const { org, mine, post, calls } = await setup();
    await db.updateTable("users").set({ locale: "en" }).where("id", "=", org.ownerId).execute();

    await post(mine);

    expect(calls).toEqual([{ mailboxId: mine, userId: org.ownerId, language: "en" }]);
  });

  test.each<{ name: string; result: StyleSuggestResult; status: number; body: unknown }>([
    {
      name: "a suggestion",
      result: { kind: "suggestion", text: "Pisze krótko.", count: 6 },
      status: 200,
      body: { text: "Pisze krótko.", count: 6 },
    },
    {
      name: "a failed run",
      result: { kind: "failed", reason: "checks" },
      status: 200,
      body: { kind: "failed", reason: "checks" },
    },
    { name: "sent tracking off", result: { kind: "sent_off" }, status: 409, body: { error: "sent_off" } },
    { name: "too few mails", result: { kind: "too_few", count: 4 }, status: 409, body: { error: "too_few", count: 4 } },
    {
      name: "an OAuth mailbox",
      result: { kind: "blocked", reason: "oauth_mailbox" },
      status: 409,
      body: { error: "blocked", reason: "oauth_mailbox" },
    },
    { name: "the day limit", result: { kind: "limit" }, status: 429, body: { error: "suggest_limit" } },
    { name: "a run in progress", result: { kind: "busy" }, status: 429, body: { error: "suggest_busy" } },
    { name: "no such mailbox", result: { kind: "not_found" }, status: 404, body: { error: "not_found" } },
  ])("the answer $name is $status", async ({ result, status, body }) => {
    const { mine, post } = await setup({ suggest: async () => result });

    const res = await post(mine);

    const json = await res.json();
    expect({ status: res.status, body: json }).toEqual({ status, body });
    // The body is the one that the API doc names for its status.
    if (status === 200) expect(styleSuggestionAnswerSchema.parse(json)).toEqual(json);
    if (status === 409) expect(styleSuggestionConflictSchema.parse(json)).toEqual(json);
  });

  test("no model client (the route has no service): 200 failed llm_off", async () => {
    const { mine, post } = await setup({ suggest: null });

    const res = await post(mine);

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 200,
      body: { kind: "failed", reason: "llm_off" },
    });
  });

  describe("with the real service", () => {
    async function realSetup(sentCount: number) {
      const fake = fakeLlm(() => CLEAN);
      const suggest = createStyleSuggestion({
        db,
        llm: fake.llm,
        dailyCap: 300,
        now: () => NOW,
        realMail: true,
        scope: { kind: "all" },
      });
      const world = await setup({ suggest, flags: { sent_sync: true } });
      const ctx = { orgId: world.org.orgId };
      await db.transaction().execute(async (trx) => {
        await writeSentSwitch(trx, ctx, world.mine, { enabled: true, at: new Date(NOW.getTime() - HOUR_MS) });
        for (let n = 0; n < sentCount; n += 1) await addSent(trx, ctx, world.mine, { order: n });
      });
      return { ...world, fake };
    }

    test("a mailbox of another organization is 404 and the model is not called", async () => {
      const { foreign, post, fake } = await realSetup(6);

      const res = await post(foreign);

      expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
      expect(fake.requests).toHaveLength(0);
    });

    test("a run with 6 sent mails is 200 with the text; its log line holds the mailbox and the count and no text", async () => {
      const { org, mine, post, fake } = await realSetup(6);
      const capture = captureLogs();
      let res: Response;
      try {
        res = await post(mine);
      } finally {
        capture.stop();
      }

      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 200,
        body: { text: CLEAN.style, count: 6 },
      });
      expect(fake.requests).toHaveLength(1);
      const [line, ...rest] = eventLines(capture.lines, "style_suggested");
      expect(rest).toHaveLength(0);
      const fields = Object.fromEntries(Object.entries(line ?? {}).filter(([key]) => !LINE_BASE.has(key)));
      expect(fields).toEqual({ org_id: org.orgId, mailbox_id: mine, count: 6 });
      expect(capture.lines.join("\n")).not.toContain("Dzień dobry");
      const audit = await db
        .selectFrom("audit_log")
        .select("data")
        .where("org_id", "=", org.orgId)
        .where("event", "=", "mailbox.style_suggested")
        .execute();
      expect(audit.map((row) => row.data)).toEqual([{ mailbox_id: mine, count: 6, outcome: "suggestion", via: "web" }]);
    });
  });
});
