import { AI_FOLDER_NAMES, type OutgoingMessage } from "@ea/core";
import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields, HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import {
  composeMessage,
  getMailbox,
  HostNotAllowedError,
  INBOX,
  listSyncFolders,
  listSyncTargets,
  MailAuthError,
  mailboxProfileOf,
  markHostBlocked,
  openMailboxProvider,
  setFolderMapEntry,
  setMailboxStatus,
  type ImapConnectOptions,
  type MailboxRow,
  type MailCapabilities,
  type MailProvider,
  type MailSender,
  type OpenDeps,
  type SmtpConnectOptions,
} from "../mail";
import { getOrganization, isFeatureOn, isOrgSuspended, listMemberships } from "../tenancy";

import { APPLY_HANDLERS, applyAction, type ApplyDeps, type FolderResolver, type ResolvableFolderKey } from "./apply";
import type { ApplyNeeds } from "./apply-shared";
import { STALE_AFTER_MS } from "./constants";
import {
  noApprovalHooks,
  noDelegationHooks,
  noLoopHooks,
  type ApprovalHooks,
  type DelegationHooks,
  type LoopHooks,
} from "./hooks";
import {
  claimActions,
  countClaimable,
  countHeldSends,
  expireStaleReady,
  releaseActions,
  type ClaimedAction,
} from "./repo";
import { claimFilterFor, sendFilterFor, type ActionsScope, type SendScope } from "./scope";

const log = createLog("actions");

const DEFAULT_BATCH_SIZE = 20;

export interface CommitterDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  scope: ActionsScope;
  // `off` when missing (the tests that never send). `main.ts` wires the SMTP opener and the scope.
  sendScope?: SendScope;
  openSender?(opts: SmtpConnectOptions): Promise<MailSender>;
  // The Graph sender and the token store; `openMailboxProvider` reads them.
  openGraphSender?: OpenDeps["openGraphSender"];
  oauthTokens?: OpenDeps["oauthTokens"];
  now(): Date;
  /** Waits between the looks for a Graph Sent copy (`ApplyDeps.sleep`). Absent: a real wait. */
  sleep?: ApplyDeps["sleep"];
  batchSize?: number;
  // The delegation callbacks and the composer. The defaults serve the tests that never send; `main.ts` wires them.
  hooks?: DelegationHooks;
  // The cards of a send that the committer closes (a changed or a missing Drafts copy lose their buttons). `main.ts` and `job:run`
  // wire `cardEditHooks`; absent = `noApprovalHooks`.
  approvalHooks?: ApprovalHooks;
  // Open loops: reads the loop of a follow-up and writes its counters. `main.ts` and `job:run` wire it; absent = no loop is open.
  loopHooks?: LoopHooks;
  compose?(message: OutgoingMessage): Promise<Buffer>;
  // Absent = `DEFAULT_SEND_LIMITS` and no callback (the older tests). `main.ts` wires them.
  sendLimits?: ApplyDeps["sendLimits"];
  onSendLimited?: ApplyDeps["onSendLimited"];
  /** The time budget of the Sent pass before a reply send (`ApplyDeps.sentBudgetMs`). Absent: the default. A test sets it small. */
  sentBudgetMs?: number;
}

// The owner and the organization of one tenant, read once per run.
interface TenantFacts {
  owner: ApplyDeps["owner"];
  organization: ApplyDeps["organization"];
}

type EnsuredFolderKey = Exclude<ResolvableFolderKey, "inbox">;

const DEFAULT_PATHS: Record<EnsuredFolderKey, string> = { ...AI_FOLDER_NAMES, drafts: "Drafts", sent: "Sent" };

// `ensureFolder` once per key per run; `inbox` is `INBOX` at once. A real path that differs from `folder_map` is stored (audit: the key, not the path).
export function createFolderResolver(
  deps: {
    db: Db | Transaction<DB>;
    now(): Date;
    provider: MailProvider;
    mailboxId: string;
    folderMap: Record<string, string>;
  },
  ctx: TenantContext
): FolderResolver {
  const map = { ...deps.folderMap };
  const cache = new Map<EnsuredFolderKey, Promise<string>>();

  async function ensure(key: EnsuredFolderKey): Promise<string> {
    const path = await deps.provider.ensureFolder(map[key] ?? DEFAULT_PATHS[key]);
    if (path !== map[key]) {
      const run = async (trx: Transaction<DB>): Promise<void> => {
        await setFolderMapEntry(trx, ctx, deps.mailboxId, key, path);
        await recordAudit(trx, ctx, {
          actor: "system",
          event: auditEvents.mailboxFolderCreated,
          at: deps.now(),
          data: { mailbox_id: deps.mailboxId, folder_key: key },
        });
      };
      await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
      map[key] = path;
    }
    return path;
  }

  return {
    resolve(key) {
      if (key === "inbox") return Promise.resolve(INBOX);
      let pending = cache.get(key);
      if (pending === undefined) {
        pending = ensure(key);
        cache.set(key, pending);
        // A failed try must not stick: the next action of the batch tries again.
        pending.catch(() => cache.delete(key));
      }
      return pending;
    },
  };
}

// What each row of a batch needs, from the handler table: IMAP, SMTP, the tenant texts, the sort folders.
const needs = (action: ClaimedAction): ApplyNeeds => APPLY_HANDLERS[action.type].needs;

// A ready original older than 24 h is never applied. One audit row per row, in one transaction.
async function expireStale(deps: CommitterDeps, ctx: TenantContext, mailboxId: string, now: Date): Promise<number> {
  const run = async (trx: Transaction<DB>): Promise<number> => {
    const expired = await expireStaleReady(trx, ctx, mailboxId, {
      now,
      staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
    });
    for (const row of expired) {
      await recordAudit(trx, ctx, {
        emailId: row.emailId,
        actionId: row.id,
        actor: "system",
        event: auditEvents.actionExpired,
        data: { action_type: row.type, reason: "stale" },
      });
    }
    return expired.length;
  };
  return deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run);
}

export function createCommitterJob(deps: CommitterDeps): { run(): Promise<void> } {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const warnedOff = new Set<string>();
  const warnedHeld = new Set<string>();

  // `now` is the claim token (`locked_at`) of every row of this batch.
  async function release(ctx: TenantContext, actions: readonly ClaimedAction[], now: Date): Promise<void> {
    await releaseActions(
      deps.db,
      ctx,
      actions.map((action) => action.id),
      now,
      now
    );
  }

  async function warnWhenHeldBack(ctx: TenantContext, mailboxId: string, now: Date): Promise<void> {
    if (deps.scope.kind !== "off" || warnedOff.has(mailboxId)) return;
    const held = await countClaimable(deps.db, ctx, mailboxId, {
      now,
      staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
      filter: { mailbox: { kind: "all" }, send: { kind: "none" } },
    });
    if (held.mailboxChanging > 0) {
      warnedOff.add(mailboxId);
      log.info("committer_actions_held", {
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        count: held.mailboxChanging,
        scope: "off",
        config_key: "ACTIONS_SCOPE",
      });
    }
  }

  // Once per process and mailbox. Runs before the `total === 0` return: a mailbox with only held sends has `total` 0.
  async function warnWhenSendsHeld(
    ctx: TenantContext,
    mailboxId: string,
    sendScope: SendScope,
    send: ReturnType<typeof sendFilterFor>
  ): Promise<void> {
    if (warnedHeld.has(mailboxId)) return;
    const held = await countHeldSends(deps.db, ctx, mailboxId, { send });
    if (held > 0) {
      warnedHeld.add(mailboxId);
      log.info("committer_sends_held", {
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        count: held,
        scope: sendScope.kind,
        config_key: "SEND_SCOPE",
      });
    }
  }

  async function openFor(
    ctx: TenantContext,
    mailboxId: string,
    batch: ClaimedAction[],
    now: Date,
    withSender: boolean
  ) {
    const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
    try {
      return await openMailboxProvider(deps, ctx, mailboxId, { withSender });
    } catch (error) {
      await release(ctx, batch, now);
      if (error instanceof MailAuthError) {
        await setMailboxStatus(deps.db, ctx, mailboxId, "auth_error", now, error.reason ?? null);
        mailboxLog.warn("committer_auth_error");
      } else if (error instanceof HostNotAllowedError) {
        await markHostBlocked(deps.db, ctx, mailboxId, { now, source: "committer" });
      } else if (error instanceof SoftError) {
        mailboxLog.warn("committer_soft_error", errorFields(error));
      } else {
        mailboxLog.error("committer_open_failed", errorFields(error));
      }
      return null;
    }
  }

  // The owner and the organization are read once per tenant and run, and only for a batch with a draft or a send.
  async function loadFacts(
    ctx: TenantContext,
    mailbox: MailboxRow,
    facts: Map<string, TenantFacts>
  ): Promise<TenantFacts> {
    const known = facts.get(ctx.orgId);
    if (known !== undefined) return known;
    const [organization, memberships] = await Promise.all([
      getOrganization(deps.db, ctx),
      listMemberships(deps.db, ctx),
    ]);
    if (organization === undefined) throw new HardError("organization not found");
    const owner = memberships.find((member) => member.role === "owner");
    const loaded: TenantFacts = {
      owner: { displayName: owner?.display_name ?? mailbox.address },
      organization: { timezone: organization.timezone },
    };
    facts.set(ctx.orgId, loaded);
    return loaded;
  }

  async function applyBatch(
    ctx: TenantContext,
    mailbox: MailboxRow,
    batch: ClaimedAction[],
    provider: MailProvider | null,
    sender: MailSender | null,
    now: Date,
    facts: TenantFacts | null,
    appendFolders: ReadonlySet<string>,
    copyCheck: boolean
  ): Promise<void> {
    const mailboxId = mailbox.id;
    const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
    const counts = { applied: 0, failed: 0, retry: 0, closed: 0, sent: 0 };
    const folders: FolderResolver =
      provider === null
        ? { resolve: () => Promise.reject(new HardError("no provider")) }
        : createFolderResolver(
            { db: deps.db, now: () => now, provider, mailboxId, folderMap: mailbox.folder_map },
            ctx
          );
    const applyDeps: ApplyDeps = {
      db: deps.db,
      now: () => now,
      mailboxId,
      folders,
      mailbox: {
        address: mailbox.address,
        capabilities: { uidplus: (mailbox.capabilities as Partial<MailCapabilities>).uidplus === true },
        folderMap: mailbox.folder_map,
        sendVia: mailbox.send_via,
      },
      // A batch without a draft or a send never reads these two.
      owner: facts?.owner ?? { displayName: mailbox.address },
      organization: facts?.organization ?? { timezone: "UTC" },
      // Read only for a batch that builds a message (the same rule as the owner and the organization).
      profile: facts === null ? null : await mailboxProfileOf(deps.db, ctx, mailboxId),
      compose: deps.compose ?? composeMessage,
      sender,
      hooks: deps.hooks ?? noDelegationHooks,
      approvalHooks: deps.approvalHooks ?? noApprovalHooks,
      copyCheck,
      loopHooks: deps.loopHooks ?? noLoopHooks,
      appendFolders,
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.sendLimits === undefined ? {} : { sendLimits: deps.sendLimits }),
      ...(deps.sentBudgetMs === undefined ? {} : { sentBudgetMs: deps.sentBudgetMs }),
      ...(deps.onSendLimited === undefined ? {} : { onSendLimited: deps.onSendLimited }),
    };
    let index = 0;
    try {
      for (; index < batch.length; index += 1) {
        const action = batch[index] as ClaimedAction;
        const outcome = await applyAction(applyDeps, ctx, action, provider);
        if (outcome.kind === "applied") {
          counts.applied += 1;
          if (action.type === "send") counts.sent += 1;
        } else if (outcome.kind === "expired") counts.closed += 1;
        else if (outcome.kind === "failed") counts.failed += 1;
        else if (outcome.kind === "retry") counts.retry += 1;
        if (outcome.kind === "auth_error") {
          await setMailboxStatus(deps.db, ctx, mailboxId, "auth_error", now, outcome.reason ?? null);
          mailboxLog.warn("committer_auth_error");
          await release(ctx, batch.slice(index), now);
          index = batch.length;
        } else if (outcome.kind === "retry" && outcome.soft) {
          await release(ctx, batch.slice(index + 1), now);
          index = batch.length;
        }
      }
    } catch (error) {
      // The untried rows go back. The row that threw stays `ready` and locked until it is stale.
      try {
        await release(ctx, batch.slice(index + 1), now);
      } catch (releaseError) {
        mailboxLog.error("committer_release_failed", errorFields(releaseError));
      }
      throw error;
    } finally {
      if (counts.applied + counts.failed + counts.retry + counts.closed > 0) {
        mailboxLog.info("committer_done", { ...counts });
      }
    }
  }

  async function processMailbox(ctx: TenantContext, mailboxId: string, facts: Map<string, TenantFacts>): Promise<void> {
    const mailbox = await getMailbox(deps.db, ctx, mailboxId);
    if (mailbox === undefined) return;
    const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
    const now = deps.now();
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

    const expired = await expireStale(deps, ctx, mailboxId, now);
    if (expired > 0) mailboxLog.warn("committer_stale_expired", { count: expired });

    const sendScope = deps.sendScope ?? { kind: "off" };
    // The flag of the reply drafts stops their sends too: an approved reply waits while it is off (the expiry job ends it).
    const replies = (await isFeatureOn(deps.db, ctx, "reply_drafts")) ? undefined : ("off" as const);
    const filter = {
      mailbox: claimFilterFor(deps.scope),
      send: sendFilterFor(sendScope),
      ...(replies === undefined ? {} : { replies }),
    };
    await warnWhenHeldBack(ctx, mailboxId, now);
    await warnWhenSendsHeld(ctx, mailboxId, sendScope, filter.send);
    const { total } = await countClaimable(deps.db, ctx, mailboxId, { now, staleBefore, filter });
    if (total === 0) return;

    const batch = await claimActions(deps.db, ctx, mailboxId, { now, limit: batchSize, staleBefore, filter });
    if (batch.length === 0) return;

    // A move into a `sort` folder is an APPEND transfer. A disabled row counts: its mail can still be undone.
    let appendFolders: ReadonlySet<string> = new Set();
    if (batch.some((action) => needs(action).sortFolders)) {
      try {
        const rows = await listSyncFolders(deps.db, ctx, mailboxId, { enabledOnly: false });
        appendFolders = new Set(rows.filter((row) => row.role === "sort").map((row) => row.path));
      } catch (error) {
        mailboxLog.error("committer_folders_failed", errorFields(error));
        await release(ctx, batch, now).catch((releaseError: unknown) => {
          mailboxLog.error("committer_release_failed", errorFields(releaseError));
        });
        return;
      }
    }

    let provider: MailProvider | null = null;
    let sender: MailSender | null = null;
    if (batch.some((action) => needs(action).provider)) {
      // The recovery of an `applying` send needs no SMTP.
      const withSender = batch.some((action) => needs(action).sender && action.status === "approved");
      const opened = await openFor(ctx, mailboxId, batch, now, withSender);
      if (opened === null) return;
      provider = opened.provider;
      sender = opened.sender;
    }
    try {
      const needsFacts = batch.some((action) => needs(action).facts);
      let tenantFacts: TenantFacts | null = null;
      if (needsFacts) {
        try {
          tenantFacts = await loadFacts(ctx, mailbox, facts);
        } catch (error) {
          mailboxLog.error("committer_facts_failed", errorFields(error));
          await release(ctx, batch, now).catch((releaseError: unknown) => {
            mailboxLog.error("committer_release_failed", errorFields(releaseError));
          });
          return;
        }
      }
      // The org flag of the edit check for every kind of send (a reply always checks); read only for a batch with a send.
      const copyCheck =
        batch.some((action) => action.type === "send") && (await isFeatureOn(deps.db, ctx, "draft_copy_check"));
      await applyBatch(ctx, mailbox, batch, provider, sender, now, tenantFacts, appendFolders, copyCheck);
    } finally {
      for (const connection of [provider, sender]) {
        await connection?.close().catch((error: unknown) => {
          mailboxLog.warn("committer_close_failed", errorFields(error));
        });
      }
    }
  }

  return {
    async run() {
      const targets = await listSyncTargets(deps.db);
      const facts = new Map<string, TenantFacts>();
      for (const { orgId, mailboxId } of targets) {
        try {
          // A suspend during the run stops the next mailbox, not only the next run.
          if (await isOrgSuspended(deps.db, { orgId })) continue;
          await processMailbox({ orgId }, mailboxId, facts);
        } catch (error) {
          log.error("committer_failed", { org_id: orgId, mailbox_id: mailboxId, ...errorFields(error) });
        }
      }
    },
  };
}
