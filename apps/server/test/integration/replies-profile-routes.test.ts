import { randomUUID } from "node:crypto";

import { buildOutgoingMessage, profileViewSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { composeMessage, mailboxProfileOf } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { replyRoutes } from "../../src/modules/replies";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// GET and PUT /api/mailboxes/:id/profile. Committed rows; the cleanup deletes both organizations.
const db = testDb();
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const CANARY = "CANARY-Zofia-Nowak-signature";

const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string): Promise<{ id: string; address: string }> {
  const id = randomUUID();
  const address = `profile-${id}@x.test`;
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  await insertInboxFolder(db, { orgId }, id);
  return { id, address };
}

async function setup() {
  const org = await webOrg(db);
  orgs.push(org);
  const mine = await addMailbox(org.orgId);
  const foreign = await addMailbox(org.otherOrgId);
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", replyRoutes({ db, preview: null })),
  });
  return { org, app, mine, foreign };
}

const put = (body: unknown) => ({ method: "PUT", body });
const profileUrl = (id: string) => `/api/mailboxes/${id}/profile`;

async function storedRow(mailboxId: string) {
  return db.selectFrom("mailbox_profiles").selectAll().where("mailbox_id", "=", mailboxId).executeTakeFirst();
}

async function profileAudits(orgId: string) {
  return db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.profile_changed")
    .orderBy("id")
    .execute();
}

describe("GET and PUT /api/mailboxes/:id/profile", () => {
  test('1. PUT displayName stores it, GET shows it, and the next draft has From: "Anna Nowak" <address>', async () => {
    const { org, app, mine } = await setup();

    const res = await app.request(profileUrl(mine.id), as("owner", put({ displayName: "Anna Nowak" })));

    expect(res.status).toBe(200);
    expect(profileViewSchema.parse(await res.json())).toEqual({
      displayName: "Anna Nowak",
      signature: null,
      writingStyle: null,
      fallbackName: "Owner",
      fallbackSignature: "Owner",
    });
    const get = await app.request(profileUrl(mine.id), as("assistant"));
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ displayName: "Anna Nowak" });
    expect((await storedRow(mine.id))?.updated_by).toBe(org.ownerId);

    // The reader: the message builder takes the stored name for the From header.
    const profile = await mailboxProfileOf(db, { orgId: org.orgId }, mine.id);
    const message = buildOutgoingMessage({
      draft: {
        kind: "reply",
        to: ["anna@client.test"],
        cc: [],
        language: "pl",
        body: "Dzień dobry",
        request_id: randomUUID(),
        folder: "INBOX",
        recipients: "from",
      },
      draftActionId: randomUUID(),
      createdAt: new Date("2026-11-18T10:00:00Z"),
      mailbox: { address: mine.address },
      owner: { displayName: "Owner" },
      organization: { timezone: "Europe/Warsaw" },
      original: {
        fromAddress: "anna@client.test",
        subject: "Spotkanie",
        receivedAt: new Date("2026-11-18T09:00:00Z"),
        messageId: "<orig@client.test>",
        inReplyTo: null,
        references: [],
        bodyText: "Czy wtorek?",
      },
      profile,
    });
    const raw = (await composeMessage(message)).toString("utf8");
    // The composer quotes a name only when it must; a name that has no special character stays plain.
    expect(raw).toMatch(new RegExp(`^From: "?Anna Nowak"? <${mine.address}>`, "m"));
  });

  test("2. a name that is not safe for a header is 400 validation, and nothing is stored or audited", async () => {
    const { org, app, mine } = await setup();
    const unsafe = [
      "A <x@y>",
      "A > B",
      'A "B"',
      "anna@x.test",
      "Anna\nBcc: evil@x.test",
      "Anna\r\nBcc: evil@x.test",
      "Anna Bcc",
    ];
    for (const displayName of unsafe) {
      const res = await app.request(profileUrl(mine.id), as("owner", put({ displayName })));
      const text = await res.text();
      expect({ displayName, status: res.status }).toEqual({ displayName, status: 400 });
      expect(JSON.parse(text)).toMatchObject({ error: "validation", details: [{ path: "displayName" }] });
      // The answer names the field and a code, never the text.
      expect(text).not.toContain("evil");
      expect(text).not.toContain("x@y");
    }
    expect(await storedRow(mine.id)).toBeUndefined();
    expect(await profileAudits(org.orgId)).toEqual([]);
  });

  test("3. an empty signature stores null; GET gives the owner name as fallbackSignature", async () => {
    const { app, mine } = await setup();
    const set = await app.request(profileUrl(mine.id), as("owner", put({ signature: CANARY })));
    expect(await set.json()).toMatchObject({ signature: CANARY, fallbackSignature: "Owner" });
    expect((await storedRow(mine.id))?.signature).toBe(CANARY);

    const cleared = await app.request(profileUrl(mine.id), as("owner", put({ signature: "" })));

    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ signature: null, fallbackSignature: "Owner" });
    expect((await storedRow(mine.id))?.signature).toBeNull();
    const get = await app.request(profileUrl(mine.id), as("owner"));
    expect(await get.json()).toMatchObject({ signature: null, fallbackSignature: "Owner" });
  });

  test("the fallbacks: no row reads null with the owner name; a clear of the name falls back too", async () => {
    const { app, mine } = await setup();
    const empty = await app.request(profileUrl(mine.id), as("owner"));
    expect(await empty.json()).toEqual({
      displayName: null,
      signature: null,
      writingStyle: null,
      fallbackName: "Owner",
      fallbackSignature: "Owner",
    });
    await app.request(profileUrl(mine.id), as("owner", put({ displayName: "Anna" })));
    const cleared = await app.request(profileUrl(mine.id), as("owner", put({ displayName: "   " })));
    expect(await cleared.json()).toMatchObject({ displayName: null, fallbackName: "Owner" });
  });

  test("4. the length limits: name 100, signature 1,000, style 1,000 characters (code points); 1,001 is 400", async () => {
    const { app, mine } = await setup();
    const ok = await app.request(
      profileUrl(mine.id),
      as("owner", put({ displayName: "n".repeat(100), signature: "s".repeat(1000), writingStyle: "😀".repeat(1000) }))
    );
    expect(ok.status).toBe(200);

    for (const body of [
      { displayName: "n".repeat(101) },
      { signature: "s".repeat(1001) },
      { writingStyle: "w".repeat(1001) },
      { writingStyle: "😀".repeat(1001) },
    ]) {
      const res = await app.request(profileUrl(mine.id), as("owner", put(body)));
      expect({ body: Object.keys(body), status: res.status }).toEqual({ body: Object.keys(body), status: 400 });
      expect(await res.json()).toMatchObject({ error: "validation" });
    }
    const row = await storedRow(mine.id);
    expect(Array.from(row?.writing_style ?? "")).toHaveLength(1000);
    expect(row?.display_name).toBe("n".repeat(100));
  });

  test("a text goes through cleanUserText: control and bidi characters are cut, a signature keeps its lines, a name is one line", async () => {
    const { app, mine } = await setup();
    const res = await app.request(
      profileUrl(mine.id),
      as(
        "owner",
        put({
          displayName: "  Anna \u0007 ‮Nowak  ",
          signature: "Line one \u0000  \r\nLine two\n\n",
          writingStyle: "Short.‎",
        })
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      displayName: "Anna Nowak",
      signature: "Line one\nLine two",
      writingStyle: "Short.",
    });
  });

  test("5. a mailbox of another organization is 404 for read and write; a member gets 403 on write for it and for an unknown id", async () => {
    const { org, app, mine, foreign } = await setup();
    for (const id of [foreign.id, UNKNOWN, "not-a-uuid"]) {
      const get = await app.request(profileUrl(id), as("owner"));
      expect({ id, status: get.status, body: await get.json() }).toEqual({
        id,
        status: 404,
        body: { error: "not_found" },
      });
      const write = await app.request(profileUrl(id), as("owner", put({ displayName: "X" })));
      expect({ id, status: write.status, body: await write.json() }).toEqual({
        id,
        status: 404,
        body: { error: "not_found" },
      });
    }
    for (const id of [foreign.id, UNKNOWN, mine.id]) {
      const write = await app.request(profileUrl(id), as("assistant", put({ displayName: "X" })));
      expect({ id, status: write.status, body: await write.json() }).toEqual({
        id,
        status: 403,
        body: { error: "owner_only" },
      });
    }
    expect(await storedRow(foreign.id)).toBeUndefined();
    expect(await storedRow(mine.id)).toBeUndefined();
    expect(await profileAudits(org.orgId)).toEqual([]);
    // The other organization's owner reads its own mailbox, and ours answers 404 for it.
    const other = await app.request(profileUrl(mine.id), as("other"));
    expect(other.status).toBe(404);
  });

  test("6. the audit row holds the changed field names and no text; an unchanged PUT writes none", async () => {
    const { org, app, mine } = await setup();
    await app.request(profileUrl(mine.id), as("owner", put({ displayName: "Anna Nowak" })));
    await app.request(profileUrl(mine.id), as("owner", put({ displayName: "Anna Nowak" })));
    await app.request(profileUrl(mine.id), as("owner", put({ signature: CANARY, writingStyle: "Warm" })));

    const audits = await profileAudits(org.orgId);

    expect(audits.map((row) => row.data)).toEqual([
      { mailbox_id: mine.id, fields: "display_name", via: "web" },
      { mailbox_id: mine.id, fields: "signature,writing_style", via: "web" },
    ]);
    expect(audits.every((row) => row.actor === org.ownerId)).toBe(true);
    const dump = JSON.stringify(audits);
    for (const text of ["Anna", "Nowak", CANARY, "Warm"]) expect(dump).not.toContain(text);
  });

  test("the audit row names only the fields that changed, not the fields that the body repeats", async () => {
    const { org, app, mine } = await setup();
    await app.request(profileUrl(mine.id), as("owner", put({ displayName: "Anna Nowak" })));

    await app.request(profileUrl(mine.id), as("owner", put({ displayName: "Anna Nowak", signature: "Sig" })));

    const audits = await profileAudits(org.orgId);
    expect(audits.map((row) => row.data)).toEqual([
      { mailbox_id: mine.id, fields: "display_name", via: "web" },
      { mailbox_id: mine.id, fields: "signature", via: "web" },
    ]);
  });

  test("a body with a wrong type is 400; a key that is left out keeps its stored value", async () => {
    const { app, mine } = await setup();
    await app.request(profileUrl(mine.id), as("owner", put({ displayName: "Anna", writingStyle: "Warm" })));
    const bad = await app.request(profileUrl(mine.id), as("owner", put({ displayName: 5 })));
    expect(bad.status).toBe(400);

    const res = await app.request(profileUrl(mine.id), as("owner", put({ signature: "Sig" })));

    expect(await res.json()).toMatchObject({ displayName: "Anna", signature: "Sig", writingStyle: "Warm" });
  });
});
