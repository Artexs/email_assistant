import { randomUUID } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { senderProfileReader } from "../../src/composition";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { claimEmails, NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import {
  type ClassifierPromptChoice,
  createLlmPause,
  loadClassifierExtras,
  noGateEvidence,
  triageOne,
  type TriageMailbox,
} from "../../src/modules/triage";
import { classifierVersions } from "../../src/modules/triage/prompts";
import type { Db, TenantContext } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

import { ago, KEY, newOrg, NOW, refresh, type Org, type Trx } from "./contacts-fixtures";
import { insertTestEmail, noSuspiciousContext, pauseOtherMailboxes, seedSenderActivity } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The profile reader of `classifier-v4` (part `profile`) in `loadClassifierExtras`. Each test fails when its guard is removed.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const ANNA = "anna@acme.pl";
type Reader = NonNullable<Parameters<typeof loadClassifierExtras>[2]["readProfile"]>;

// Eight mails of Anna, six answered, three Sent mails to her; the pass has run.
async function seeded(trx: Trx, opts: { flag?: boolean } = {}): Promise<Org> {
  const org = await newOrg(trx);
  await seedSenderActivity(trx, org.ctx, org.mailboxId, {
    address: ANNA,
    mails: Array.from({ length: 8 }, (_, index) => ({
      at: ago(2 + index),
      category: "info" as const,
      answered: index < 6,
    })),
    sent: [1, 2, 3].map((day) => ({ at: ago(20 + day), to: [ANNA] })),
  });
  await refresh(trx, org);
  if (opts.flag === false) {
    await setOrgFeature(trx, org.ctx, { flag: "sender_context", enabled: false, actor: "cli", now: NOW });
  }
  return org;
}

const email = (from: string | null) => ({
  id: randomUUID(),
  from_address: from,
  received_at: NOW,
  message_id_header: `<${randomUUID()}@x.test>`,
});

function load(
  trx: Trx,
  ctx: TenantContext,
  mailboxId: string,
  input: { parts: ("profile" | "history" | "list")[]; from?: string | null; suspicious?: string[]; reader: Reader }
) {
  return loadClassifierExtras(trx, ctx, {
    mailbox: { id: mailboxId, urgencyProfile: null },
    email: email(input.from === undefined ? ANNA : input.from),
    parts: input.parts,
    timezone: "Europe/Warsaw",
    testMail: NO_TEST_SENDERS,
    suspicious: input.suspicious ?? [],
    readProfile: input.reader,
  });
}

const readerOf = (trx: Trx) => senderProfileReader({ db: trx as unknown as Db, credentialsKey: KEY, now: () => NOW });
const spy = (reader: Reader): { reader: Reader; calls: () => number } => {
  let count = 0;
  return {
    reader: (...args) => {
      count += 1;
      return reader(...args);
    },
    calls: () => count,
  };
};

describe("loadClassifierExtras reads the profile for the part profile", () => {
  test("6a. a stored profile gives senderProfile; the v4 prompt shows it and no address", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      const extras = await load(trx, org.ctx, org.mailboxId, { parts: ["profile"], reader: readerOf(trx) });
      expect(extras.senderProfile).toMatchObject({
        relation: "known",
        received: 8,
        answered: 6,
        userMailsTo: 3,
        days: 90,
      });
      const prompt = classifierVersions["classifier-v4"].buildUser(
        {
          from: ANNA,
          to: [],
          cc: [],
          subject: "S",
          receivedAt: NOW,
          bodyText: "B",
          thread: [],
        },
        { whitelisted: false, vip: false, noreply: false },
        [],
        "NONCE",
        extras,
        ["profile"]
      );
      const section = prompt.slice(prompt.indexOf("Sender profile"), prompt.indexOf("The email to classify:"));
      expect(section).toContain("relation: known");
      expect(section).toContain("answered 6 of 8");
      expect(section).not.toContain("@");
    });
  });

  test("6b. a sender with no stored row gives null; so does an upper-case address with the row", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      const none = await load(trx, org.ctx, org.mailboxId, {
        parts: ["profile"],
        from: "nobody@acme.pl",
        reader: readerOf(trx),
      });
      expect(none.senderProfile).toBeNull();
      const upper = await load(trx, org.ctx, org.mailboxId, {
        parts: ["profile"],
        from: " ANNA@Acme.PL ",
        reader: readerOf(trx),
      });
      expect(upper.senderProfile?.relation).toBe("known");
      // The reader itself takes a raw address: the key of its answer is the normalised one.
      expect((await readerOf(trx)(org.ctx, org.mailboxId, " ANNA@Acme.PL "))?.relation).toBe("known");
    });
  });

  test("7. a flagged mail reads no profile: the reader is not called", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      const probe = spy(readerOf(trx));
      const extras = await load(trx, org.ctx, org.mailboxId, {
        parts: ["profile"],
        suspicious: ["lookalike_domain"],
        reader: probe.reader,
      });
      expect(extras.senderProfile).toBeNull();
      expect(probe.calls()).toBe(0);
    });
  });

  test("8. without the part profile no profile query runs; a mail with no sender address runs none", async () => {
    await withRollback(db, async (trx) => {
      const org = await seeded(trx);
      const probe = spy(readerOf(trx));
      for (const parts of [[], ["history"], ["list"]] as const) {
        const extras = await load(trx, org.ctx, org.mailboxId, { parts: [...parts], reader: probe.reader });
        expect(extras.senderProfile).toBeNull();
      }
      const noSender = await load(trx, org.ctx, org.mailboxId, {
        parts: ["profile"],
        from: null,
        reader: probe.reader,
      });
      expect(noSender.senderProfile).toBeNull();
      expect(probe.calls()).toBe(0);
    });
  });

  test("9. flag sender_context off: the reader of the composition root gives null; another org's row is not read", async () => {
    await withRollback(db, async (trx) => {
      const off = await seeded(trx, { flag: false });
      const extras = await load(trx, off.ctx, off.mailboxId, { parts: ["profile"], reader: readerOf(trx) });
      expect(extras.senderProfile).toBeNull();

      const on = await seeded(trx);
      const other = await newOrg(trx);
      const crossOrg = await load(trx, other.ctx, on.mailboxId, { parts: ["profile"], reader: readerOf(trx) });
      expect(crossOrg.senderProfile).toBeNull();
    });
  });
  // The job hands its reader down: `triageOne` -> `buildClassifierInput` -> `loadClassifierExtras`. Dropping the handoff at
  // either hop leaves the prompt with no profile block, so each assertion below fails.
  test("10. triageOne with the prompt v4[profile] and a reader: the LLM prompt holds the profile; with no reader it holds none", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const org = await seeded(trx);
      await insertDefaultSettings(trx, org.ctx, org.mailboxId);
      const settings = await getMailboxSettings(trx, org.ctx, org.mailboxId);
      if (!settings) throw new Error("no settings");
      const mailbox: TriageMailbox = {
        id: org.mailboxId,
        settingsVersion: settings.version,
        mode: "shadow",
        toolSwitches: { move: false, mark_read: false, flag: false, create_draft: false, move_unsure: false },
        runningKey: noGateEvidence.runningKey,
        policy: {},
        rules: [],
        movesSupported: false,
        delegates: [],
        timezone: "Europe/Warsaw",
        junkFolder: null,
        resumedAt: null,
        suspicious: noSuspiciousContext,
        urgencyProfile: null,
      };
      const prompt: ClassifierPromptChoice = { version: "classifier-v4", parts: ["profile"] };

      async function run(reader: Reader | undefined): Promise<{ system: string; user: string }> {
        const id = await insertTestEmail(trx, org.ctx, org.mailboxId, {
          from_address: ANNA,
          received_at: new Date(NOW.getTime() - MINUTE_MS),
          subject: "Offer",
          body_text: "Please look at the offer.",
        });
        const mails = await claimEmails(trx, org.ctx, org.mailboxId, {
          now: NOW,
          limit: 10,
          staleBefore: new Date(NOW.getTime() - 5 * MINUTE_MS),
          syntheticOnly: false,
        });
        const email = mails.find((mail) => mail.id === id);
        if (!email) throw new Error("claim failed");
        const seen: { system: string; user: string }[] = [];
        const llm = {
          modelOf: () => "fake-model",
          endpointOf: () => "standard",
          providerOf: () => "openai",
          async generate(req) {
            seen.push({ system: req.system, user: req.prompt });
            return {
              data: req.schema.parse({
                category: "info",
                confidence: 0.95,
                reason_code: "newsletter",
                reason: "test",
                summary: "short summary",
                fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
              }),
              usage: {
                role: req.role,
                promptVersion: req.promptVersion,
                model: "fake-model",
                tokensIn: 100,
                tokensOut: 20,
                latencyMs: 300,
                endpoint: "standard" as const,
                provider: "openai" as const,
              },
            };
          },
        } as LlmClient;
        const outcome = await triageOne(
          {
            db: trx,
            llm,
            pause: createLlmPause(),
            testMail: NO_TEST_SENDERS,
            dailyCap: 1000,
            junkDailyCap: 1000,
            now: () => NOW,
            prompt,
            ...(reader === undefined ? {} : { readProfile: reader }),
          },
          org.ctx,
          mailbox,
          email
        );
        expect(outcome.kind).toBe("triaged");
        expect(seen).toHaveLength(1);
        return seen[0] as { system: string; user: string };
      }

      const probe = spy(readerOf(trx));
      const withReader = await run(probe.reader);
      expect(probe.calls()).toBe(1);
      expect(withReader.user).toContain("Sender profile (counts from the user's mailbox");
      expect(withReader.user).toContain("- relation: known");
      expect(withReader.user).toContain("answered 6 of 8");
      // The mail's own From line holds the address (it is mail data); the profile block never does.
      const block = withReader.user.slice(
        withReader.user.indexOf("Sender profile ("),
        withReader.user.indexOf("The email to classify:")
      );
      expect(block).not.toContain("@");
      expect(withReader.system).toContain("The sender profile gives counts");

      const without = await run(undefined);
      expect(without.user).not.toContain("Sender profile (");
      // The rule line belongs to the part, not to the mail: it stays.
      expect(without.system).toContain("The sender profile gives counts");
    });
  });
});
