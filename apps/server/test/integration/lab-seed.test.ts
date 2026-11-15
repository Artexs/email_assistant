import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { featureKeys, planLiveRun } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import { consumeLinkToken } from "../../src/modules/channels";
import { getMailboxSettings, listSenderRules } from "../../src/modules/config";
import { listDelegates } from "../../src/modules/delegation";
import {
  createLabState,
  LAB_FLAGS_OFF,
  LAB_FLAGS_ON,
  LAB_IMAP_PORT,
  LAB_MAIL_HOST,
  LAB_SMTP_PORT,
  LAB_TARGETS,
  LabSeedError,
  loadLabCorpus,
  seedLabOrg,
  storeRunUrgencyProfile,
  unlistedFlags,
  type FakeTgClient,
  type LabCorpus,
  type LabState,
  type SeedDeps,
  type SeedTarget,
} from "../../src/modules/lab";
import { listMailboxes, type ConnectDeps } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { imapFlowOptions } from "../../src/modules/mail/imap/client";
import { listOrgFeatureRows } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDelegate, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const SIM_ROOT = resolve(import.meta.dir, "../../../../evals/sim");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const START = new Date("2026-11-20T08:00:00.000Z");

let corpus: LabCorpus;
beforeAll(async () => {
  corpus = await loadLabCorpus(SIM_ROOT, "lab-01");
});
afterAll(async () => {
  await db.destroy();
});

const personaOf = (key: string) => {
  const persona = corpus.scenario.personas.find((candidate) => candidate.key === key);
  if (persona === undefined) throw new Error(`persona ${key} is missing`);
  return persona;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A target with a random mailbox address (the owner email is the mailbox address: unique) and a random chat id.
const randomTarget = (base: SeedTarget = LAB_TARGETS.lab): SeedTarget => ({
  ...base,
  mailbox: `seed-${randomUUID()}@kordelan.test`,
  chatId: randomChatId(),
});

// The fake Telegram and the server runtime in one object. `serverUp` false = no Telegram runtime: `/start` is ignored.
function fakeTg(trx: Transaction<DB>, now: () => Date) {
  let chats = new Set<number>();
  const sent: string[] = [];
  const client: FakeTgClient = {
    async send(chatId, text) {
      sent.push(text.startsWith("/start ") ? "/start" : text);
      chats.add(chatId);
      if (control.serverUp && text.startsWith("/start ")) {
        await consumeLinkToken(trx, { token: text.slice("/start ".length), chatId, now: now() });
      }
    },
    read: async () => [],
    press: async () => undefined,
    hasChat: async (chatId) => chats.has(chatId),
  };
  const control = {
    client,
    sent,
    serverUp: true,
    // A restarted fake holds no chat.
    restart: () => {
      chats = new Set();
    },
  };
  return control;
}

interface Harness {
  deps: SeedDeps;
  state: LabState;
  tg: ReturnType<typeof fakeTg>;
  connects: { host: string; port: number; smtpHost: string; smtpPort: number; address: string }[];
  sleeps: number[];
}

function harness(trx: Transaction<DB>): Harness {
  const dir = mkdtempSync(join(tmpdir(), "f113-s06-seed-"));
  dirs.push(dir);
  let clock = START.getTime();
  const now = () => new Date(clock);
  const state = createLabState(dir, now);
  const tg = fakeTg(trx, now);
  const connects: Harness["connects"] = [];
  const sleeps: number[] = [];
  const pendingHosts: { host: string; port: number }[] = [];
  const connect: ConnectDeps = {
    db: trx,
    secrets,
    openProvider: async (opts) => {
      pendingHosts.push({ host: opts.host, port: opts.port });
      return createFakeMailProvider();
    },
    verifySmtp: async (opts) => {
      const imap = pendingHosts.pop();
      connects.push({
        host: imap?.host ?? "",
        port: imap?.port ?? 0,
        smtpHost: opts.host,
        smtpPort: opts.port,
        address: opts.user,
      });
    },
  };
  const deps: SeedDeps = {
    db: trx,
    connect,
    settings: settingsDeps(trx, now),
    state,
    tg: tg.client,
    now,
    // A fake clock: the wait for the link ends at once.
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    linkTimeoutMs: 5000,
    pollMs: 1000,
  };
  return { deps, state, tg, connects, sleeps };
}

async function counts(trx: Transaction<DB>, orgId: string, mailboxId: string) {
  return {
    mailboxes: (await listMailboxes(trx, { orgId })).length,
    delegates: (await listDelegates(trx, { orgId })).length,
    vip: (await listSenderRules(trx, { orgId }, mailboxId)).filter((rule) => rule.kind === "vip").length,
    flags: (await listOrgFeatureRows(trx, { orgId })).length,
  };
}

const orgCount = async (trx: Transaction<DB>): Promise<number> =>
  Number(
    (
      await trx
        .selectFrom("organizations")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow()
    ).n
  );

describe("seedLabOrg (F113 stage 06)", () => {
  test("1: the first seed makes the org, the mailbox, 3 delegates with tags, 2 vip rules and the assist mode", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const target = randomTarget();
      const result = await seedLabOrg(h.deps, corpus.scenario, target);
      const { org } = result;
      expect(result.created).toBe(true);
      expect(result.added).toEqual({
        mailbox: 1,
        delegates: 3,
        rules: 2,
        flags: LAB_FLAGS_ON.length,
        linked: true,
        relinked: false,
      });
      expect(await counts(trx, org.orgId, org.mailboxId)).toEqual({
        mailboxes: 1,
        delegates: 3,
        vip: 2,
        flags: LAB_FLAGS_ON.length,
      });
      const delegates = await listDelegates(trx, { orgId: org.orgId });
      const wanted = corpus.scenario.delegates.map(({ persona, tags }) => {
        const found = personaOf(persona);
        return { email: found.address, name: found.displayName, tags: [...tags].sort() };
      });
      expect(
        delegates.map((row) => ({ email: row.email, name: row.name, tags: [...row.competence_tags].sort() }))
      ).toEqual(expect.arrayContaining(wanted));
      const vipPatterns = (await listSenderRules(trx, { orgId: org.orgId }, org.mailboxId)).map((rule) => rule.pattern);
      const vipWanted = corpus.scenario.urgency.vip.map((key) => personaOf(key).address);
      expect(vipPatterns.sort()).toEqual(vipWanted.sort());
      expect((await getMailboxSettings(trx, { orgId: org.orgId }, org.mailboxId))?.mode).toBe("assist");
      // The org row: the target name, the active plan, Warsaw; the owner holds the executive name.
      const row = await trx
        .selectFrom("organizations")
        .select(["name", "plan", "timezone"])
        .where("id", "=", org.orgId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ name: "Kordelan lab", plan: "active", timezone: "Europe/Warsaw" });
      expect(h.state.readOrgs().lab).toEqual({ ...org, address: target.mailbox, chatId: target.chatId });
      expect(h.tg.sent).toEqual(["/start"]);
    });
  });

  test("1b: the lab mailbox host is the loopback address 127.0.0.1 and nothing else (the env guard does not check it)", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const target = randomTarget();
      const { org } = await seedLabOrg(h.deps, corpus.scenario, target);
      expect(LAB_MAIL_HOST).toBe("127.0.0.1");
      // The reason: the server opens plain IMAP and SMTP (GreenMail on 3143 and 3025) only to a loopback host.
      expect(
        imapFlowOptions(
          { host: LAB_MAIL_HOST, port: LAB_IMAP_PORT, user: "u", auth: { kind: "password", password: "p" } },
          { host: LAB_MAIL_HOST }
        ).secure
      ).toBe(false);
      expect(() =>
        imapFlowOptions(
          {
            host: "greenmail",
            port: LAB_IMAP_PORT,
            user: "u",
            auth: { kind: "password", password: "p" },
            secure: false,
          },
          { host: "greenmail" }
        )
      ).toThrow("plain IMAP");
      expect(h.connects).toEqual([
        {
          host: "127.0.0.1",
          port: LAB_IMAP_PORT,
          smtpHost: "127.0.0.1",
          smtpPort: LAB_SMTP_PORT,
          address: target.mailbox,
        },
      ]);
      const row = await trx
        .selectFrom("mailboxes")
        .select(["imap_host", "imap_port", "smtp_host", "smtp_port"])
        .where("id", "=", org.mailboxId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ imap_host: "127.0.0.1", imap_port: 3143, smtp_host: "127.0.0.1", smtp_port: 3025 });
      // The demo target uses the same host: there is no other.
      const demo = await seedLabOrg(harness(trx).deps, corpus.scenario, randomTarget(LAB_TARGETS.demo));
      const demoRow = await trx
        .selectFrom("mailboxes")
        .select(["imap_host", "smtp_host"])
        .where("id", "=", demo.org.mailboxId)
        .executeTakeFirstOrThrow();
      expect(demoRow).toEqual({ imap_host: "127.0.0.1", smtp_host: "127.0.0.1" });
      expect((await getMailboxSettings(trx, { orgId: demo.org.orgId }, demo.org.mailboxId))?.mode).toBe("shadow");
    });
  });

  test("2: the second seed makes nothing new: created false, the same counts, no connect, no /start", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const target = randomTarget();
      const first = await seedLabOrg(h.deps, corpus.scenario, target);
      const before = await counts(trx, first.org.orgId, first.org.mailboxId);
      const orgs = await orgCount(trx);
      const second = await seedLabOrg(h.deps, corpus.scenario, target);
      expect(second.created).toBe(false);
      expect(second.org).toEqual(first.org);
      expect(second.added).toEqual({ mailbox: 0, delegates: 0, rules: 0, flags: 0, linked: false, relinked: false });
      expect(await counts(trx, first.org.orgId, first.org.mailboxId)).toEqual(before);
      expect(await orgCount(trx)).toBe(orgs);
      expect(h.connects).toHaveLength(1);
      expect(h.tg.sent).toEqual(["/start"]);
    });
  });

  test("2b: a repair run keeps the switches of the mode (it sets the mode only when it differs)", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const { org } = await seedLabOrg(h.deps, corpus.scenario, randomTarget());
      await trx
        .updateTable("mailbox_settings")
        .set({
          tool_switches: JSON.stringify({
            move: false,
            mark_read: true,
            flag: true,
            create_draft: false,
            move_unsure: false,
          }),
        })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      const before = (await getMailboxSettings(trx, { orgId: org.orgId }, org.mailboxId))?.tool_switches;
      await seedLabOrg(h.deps, corpus.scenario, { ...LAB_TARGETS.lab, mailbox: org.address, chatId: org.chatId });
      expect((await getMailboxSettings(trx, { orgId: org.orgId }, org.mailboxId))?.tool_switches).toEqual(before);
    });
  });

  test("3: a delegate, a vip rule and a flag row deleted between the seeds come back; counts are 3, 2 and all flags", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const target = randomTarget();
      const { org } = await seedLabOrg(h.deps, corpus.scenario, target);
      const ctx = { orgId: org.orgId };
      const victim = (await listDelegates(trx, ctx))[0];
      await trx
        .deleteFrom("delegates")
        .where("id", "=", victim?.id as string)
        .execute();
      const rule = (await listSenderRules(trx, ctx, org.mailboxId))[0];
      await trx
        .deleteFrom("sender_rules")
        .where("org_id", "=", org.orgId)
        .where("pattern", "=", rule?.pattern as string)
        .execute();
      await trx.deleteFrom("org_features").where("org_id", "=", org.orgId).where("flag", "=", "stats_page").execute();
      expect((await counts(trx, org.orgId, org.mailboxId)).delegates).toBe(2);

      const second = await seedLabOrg(h.deps, corpus.scenario, target);
      expect(second.created).toBe(false);
      expect(second.added).toEqual({ mailbox: 0, delegates: 1, rules: 1, flags: 1, linked: false, relinked: false });
      expect(await counts(trx, org.orgId, org.mailboxId)).toEqual({
        mailboxes: 1,
        delegates: 3,
        vip: 2,
        flags: LAB_FLAGS_ON.length,
      });
    });
  });

  test("3b: a deleted mailbox is connected again and orgs.json holds the new mailbox id", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const target = randomTarget();
      const first = await seedLabOrg(h.deps, corpus.scenario, target);
      await trx.deleteFrom("mailboxes").where("id", "=", first.org.mailboxId).execute();
      const second = await seedLabOrg(h.deps, corpus.scenario, target);
      expect(second.added.mailbox).toBe(1);
      expect(second.org.mailboxId).not.toBe(first.org.mailboxId);
      expect(h.state.readOrgs().lab?.mailboxId).toBe(second.org.mailboxId);
      expect((await counts(trx, second.org.orgId, second.org.mailboxId)).mailboxes).toBe(1);
    });
  });

  test("4: orgs.json names an org id that is gone: org_gone, and no new org", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      h.state.writeOrgs({
        lab: { orgId: randomUUID(), mailboxId: randomUUID(), address: "x@kordelan.test", chatId: 1 },
      });
      const orgs = await orgCount(trx);
      await expect(seedLabOrg(h.deps, corpus.scenario, randomTarget())).rejects.toMatchObject({ code: "org_gone" });
      await expect(seedLabOrg(h.deps, corpus.scenario, randomTarget())).rejects.toBeInstanceOf(LabSeedError);
      expect(await orgCount(trx)).toBe(orgs);
      expect(h.connects).toEqual([]);
    });
  });

  test("5: after the seed the chat is linked to the owner; with no Telegram runtime the seed ends in telegram_link_timeout", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const target = randomTarget();
      const { org } = await seedLabOrg(h.deps, corpus.scenario, target);
      const link = await trx
        .selectFrom("chat_links")
        .select(["external_chat_id", "user_id"])
        .where("org_id", "=", org.orgId)
        .executeTakeFirstOrThrow();
      expect(Number(link.external_chat_id)).toBe(target.chatId);

      const down = harness(trx);
      down.tg.serverUp = false;
      const downTarget = randomTarget();
      await expect(seedLabOrg(down.deps, corpus.scenario, downTarget)).rejects.toMatchObject({
        code: "telegram_link_timeout",
      });
      // The wait polled and the fake clock reached the limit.
      expect(down.sleeps).toEqual([1000, 1000, 1000, 1000, 1000]);
      // The org stays and orgs.json names it: the next seed does not make a second org, it tries the link again.
      const orgs = await orgCount(trx);
      expect(down.state.readOrgs().lab).toBeDefined();
      down.tg.serverUp = true;
      const retry = await seedLabOrg(down.deps, corpus.scenario, downTarget);
      expect(retry.created).toBe(false);
      expect(retry.added.linked).toBe(true);
      expect(retry.added.mailbox).toBe(0);
      expect(await orgCount(trx)).toBe(orgs);
    });
  });

  test("6: after a fake restart the DB link stays, the second seed makes the chat known with /help and sends no /start", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const target = randomTarget();
      await seedLabOrg(h.deps, corpus.scenario, target);
      expect(await h.tg.client.hasChat(target.chatId)).toBe(true);
      h.tg.restart();
      expect(await h.tg.client.hasChat(target.chatId)).toBe(false);
      h.tg.sent.length = 0;
      const second = await seedLabOrg(h.deps, corpus.scenario, target);
      expect(await h.tg.client.hasChat(target.chatId)).toBe(true);
      expect(h.tg.sent).toEqual(["/help"]);
      expect(second.added).toEqual({ mailbox: 0, delegates: 0, rules: 0, flags: 0, linked: false, relinked: true });
      // A third seed with the chat known sends nothing.
      h.tg.sent.length = 0;
      await seedLabOrg(h.deps, corpus.scenario, target);
      expect(h.tg.sent).toEqual([]);
    });
  });

  test("7: a second org of another test is not changed by the seed", async () => {
    await withRollback(db, async (trx) => {
      const other = await createOrgWithMailbox(trx);
      // The same delegate address as a persona: a seed that leaks across orgs would see it as "exists".
      const persona = corpus.scenario.personas.find((candidate) => candidate.key === "asystentka");
      await insertDelegate(
        trx,
        { orgId: other.orgId },
        { email: persona?.address, name: "Other delegate", tags: ["x"] }
      );
      const before = await counts(trx, other.orgId, other.mailboxId);
      const modeBefore = (await getMailboxSettings(trx, { orgId: other.orgId }, other.mailboxId))?.mode;

      const h = harness(trx);
      const { org } = await seedLabOrg(h.deps, corpus.scenario, randomTarget());
      expect(org.orgId).not.toBe(other.orgId);
      expect(await counts(trx, other.orgId, other.mailboxId)).toEqual(before);
      expect((await getMailboxSettings(trx, { orgId: other.orgId }, other.mailboxId))?.mode).toBe(modeBefore);
      expect((await listDelegates(trx, { orgId: other.orgId })).map((row) => row.name)).toEqual(["Other delegate"]);
      // The seeded org still gets its own delegate with that address.
      expect((await counts(trx, org.orgId, org.mailboxId)).delegates).toBe(3);
    });
  });

  test("8: after the seed each flag of LAB_FLAGS_ON is on and org_delete is off; a key in no list fails the list test", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const { org } = await seedLabOrg(h.deps, corpus.scenario, randomTarget());
      const rows = new Map((await listOrgFeatureRows(trx, { orgId: org.orgId })).map((row) => [row.flag, row.enabled]));
      for (const flag of LAB_FLAGS_ON) expect(rows.get(flag)).toBe(true);
      for (const flag of LAB_FLAGS_OFF) expect(rows.get(flag) ?? false).toBe(false);
      expect(rows.get("mistake_capture")).toBe(true);
    });
    expect(unlistedFlags(featureKeys)).toEqual([]);
    expect(unlistedFlags([...featureKeys, "future_flag"])).toEqual(["future_flag"]);
    expect(LAB_FLAGS_ON.filter((flag) => (LAB_FLAGS_OFF as readonly string[]).includes(flag))).toEqual([]);
  });

  test("9: the run stores the scenario topics and the shifted plan deadlines as the urgency profile of the mailbox", async () => {
    await withRollback(db, async (trx) => {
      const h = harness(trx);
      const { org } = await seedLabOrg(h.deps, corpus.scenario, randomTarget());
      const plan = planLiveRun({
        scenario: corpus.scenario,
        slots: [...corpus.slots.values()],
        mode: "day",
        startDate: "2026-11-23",
        runId: "day-20261123-aaaa",
      });
      if ("refused" in plan) throw new Error(plan.refused);
      const deps = { db: trx, scenario: corpus.scenario };

      expect(await storeRunUrgencyProfile(deps, org, plan)).toBe(true);
      const stored = (await getMailboxSettings(trx, { orgId: org.orgId }, org.mailboxId))?.urgency_profile;
      expect(stored).toEqual({ topics: corpus.scenario.urgency.profile.topics, deadlines: plan.deadlines });
      expect(plan.deadlines).toHaveLength(4);
      // The same plan again changes nothing.
      expect(await storeRunUrgencyProfile(deps, org, plan)).toBe(false);
    });
  });
});
