import { randomUUID } from "node:crypto";

import { approvalRoutes, replyApprovalRoutes } from "../../src/modules/channels";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { isOrgSuspended, setOrgFeature } from "../../src/modules/tenancy";
import type { Db } from "../../src/platform/db";

import { testCapabilities } from "./fixtures";
import {
  addReplyMail,
  CLEAN_ANSWER,
  draftedReply,
  fakeLlm,
  jobDeps,
  NOW,
  runJob,
  setMailAddresses,
  setSwitch,
  type Clock,
  type FakeAnswer,
  type JobBox,
  type MailOpts,
} from "./reply-job-fixtures";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The world of the reply route tests: committed rows (an organization with an owner and a member, a second organization), a
// mailbox for each with every gate of the reply drafts open, the routes with the real card hook, a fake model and the drafter job.
// Every file builds its own kit with its own `db`; the clock is the fixed `NOW` of the reply fixtures.
const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };

export const post = (who: string, body: unknown = {}, init: { origin?: string } = {}): RequestInit => {
  const base = as(who, { method: "POST", body });
  if (init.origin === undefined) return base;
  return { ...base, headers: { ...(base.headers as Record<string, string>), origin: init.origin } };
};

export interface Flags {
  approvals_page?: boolean;
  reply_drafts?: boolean;
}

export function replyWebKit(db: Db) {
  const orgs: WebOrg[] = [];
  const clock: Clock = { now: NOW };

  async function addMailbox(orgId: string): Promise<{ id: string; address: string }> {
    const ctx = { orgId };
    const id = randomUUID();
    const address = `reply-web-${id}@x.test`;
    await insertMailbox(db, ctx, {
      id,
      address,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: { ...testCapabilities, uidplus: true },
      folderMap: { drafts: "Drafts" },
    });
    await insertInboxFolder(db, ctx, id);
    await db.transaction().execute(async (trx) => {
      await insertDefaultSettings(trx, ctx, id);
      await updateMailboxSettings(trx, ctx, id, { mode: "assist", toolSwitches: SWITCHES });
    });
    await setSwitch(db, id, true);
    return { id, address };
  }

  async function setFlags(orgId: string, flags: Flags): Promise<void> {
    for (const [flag, enabled] of Object.entries(flags)) {
      await setOrgFeature(db, { orgId }, { flag: flag as keyof Flags, enabled, actor: "cli", now: NOW });
    }
  }

  // Both flags are on for both organizations unless a test names others.
  async function setup(flags: Flags = {}) {
    const org = await webOrg(db);
    orgs.push(org);
    const mine = await addMailbox(org.orgId);
    const theirs = await addMailbox(org.otherOrgId);
    const on = { approvals_page: true, reply_drafts: true, ...flags };
    await setFlags(org.orgId, on);
    await setFlags(org.otherOrgId, { approvals_page: true, reply_drafts: true });
    const box: JobBox = { ctx: { orgId: org.orgId }, userId: org.ownerId, mailboxId: mine.id, address: mine.address };
    const theirBox: JobBox = {
      ctx: { orgId: org.otherOrgId },
      userId: org.otherOwnerId,
      mailboxId: theirs.id,
      address: theirs.address,
    };
    const routeDeps = {
      db,
      now: () => NOW,
      sendScope: { kind: "all" } as const,
      hooks: delegationHooks({ db }),
      uidplus: async () => true,
    };
    const app = webTestApp({
      db,
      sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
      isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId }),
      routers: (api) => {
        api.route("/", approvalRoutes(routeDeps));
        api.route("/", replyApprovalRoutes(routeDeps));
      },
    });
    return { org, box, theirBox, app, setFlags: (next: Flags) => setFlags(org.orgId, next) };
  }

  // A mail that waits for a tap (category `info`: no automatic draft) and the drafter job on it with a fake model.
  const mailOf = (box: JobBox, opts: MailOpts = {}) =>
    db.transaction().execute((trx) => addReplyMail(trx, box, { category: "info", ...opts }));

  // A mail that the job has drafted: the mail id and its waiting send (version 1).
  const draftOf = (box: JobBox, opts: MailOpts = {}) =>
    db.transaction().execute((trx) => draftedReply(trx, box, clock, opts));

  // The job runs once; returns the instructions of the model calls that reached the fake model.
  async function runDrafter(box: JobBox, answer: FakeAnswer = CLEAN_ANSWER): Promise<number> {
    const { llm, requests } = fakeLlm(() => answer);
    await runJob(jobDeps(db, llm, clock), box);
    return requests.length;
  }

  // The committer has put the drafts in Drafts: a send can be approved (`draft_not_ready` otherwise).
  const applyDrafts = (box: JobBox) =>
    db
      .updateTable("actions")
      .set({ status: "applied", applied_at: NOW })
      .where("org_id", "=", box.ctx.orgId)
      .where("type", "=", "create_draft")
      .where("status", "=", "ready")
      .execute();

  const addresses = (emailId: string, values: Parameters<typeof setMailAddresses>[2]) =>
    setMailAddresses(db, emailId, values);

  async function cleanup(): Promise<void> {
    for (const org of orgs) await org.cleanup();
    orgs.length = 0;
  }

  return { setup, addMailbox, mailOf, draftOf, runDrafter, applyDrafts, addresses, cleanup, clock };
}

export type ReplyKit = ReturnType<typeof replyWebKit>;
export type ReplyWorld = Awaited<ReturnType<ReplyKit["setup"]>>;
