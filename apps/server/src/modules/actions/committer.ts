import { AI_FOLDER_NAMES, type OutgoingMessage } from "@ea/core";
import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError, HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import {
  composeMessage,
  getMailbox,
  INBOX,
  listSyncFolders,
  listSyncTargets,
  MailAuthError,
  openMailboxProvider,
  setFolderMapEntry,
  setMailboxStatus,
  type ImapConnectOptions,
  type MailboxRow,
  type MailCapabilities,
  type MailProvider,
  type MailSender,
  type SmtpConnectOptions,
} from "../mail";
import { getOrganization, isOrgSuspended, listMemberships } from "../tenancy";

import { APPLY_HANDLERS, applyAction, type ApplyDeps, type FolderResolver, type ResolvableFolderKey } from "./apply";
import type { ApplyNeeds } from "./apply-shared";
import { STALE_AFTER_MS } from "./constants";
import { noDelegationHooks, type DelegationHooks } from "./hooks";
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
  // S4: `off` when missing (the tests of S3). `main.ts` wires the SMTP opener and the scope (stage 18).
  sendScope?: SendScope;
  openSender?(opts: SmtpConnectOptions): Promise<MailSender>;
  now(): Date;
  batchSize?: number;
  // S4 (D33): the delegation callbacks and the composer. The defaults serve the tests of S3; `main.ts` wires them (stage 18).
  hooks?: DelegationHooks;
  compose?(message: OutgoingMessage): Promise<Buffer>;
  // PD-044: absent = `DEFAULT_SEND_LIMITS` and no callback (the older tests). `main.ts` wires them (stage 04).
  sendLimits?: ApplyDeps["sendLimits"];
  onSendLimited?: ApplyDeps["onSendLimited"];
}

// The owner and the organization of one tenant, read once per run (D12).
interface TenantFacts {
  owner: ApplyDeps["owner"];
  organization: ApplyDeps["organization"];
}

type EnsuredFolderKey = Exclude<ResolvableFolderKey, "inbox">;

const DEFAULT_PATHS: Record<EnsuredFolderKey, string> = { ...AI_FOLDER_NAMES, drafts: "Drafts", sent: "Sent" };

// D9: `ensureFolder` once per key per run; `inbox` is `INBOX` at once (D12). A real path that differs from `folder_map` is stored (audit: the key, not the path).
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

// D21: a ready original older than 24 h is never applied. One audit row per row, in one transaction.
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
      log.info(`committer: ACTIONS_SCOPE=off, ${held.mailboxChanging} mailbox actions wait in mailbox ${mailboxId}`);
    }
  }

  // D16: once per process and mailbox. Runs before the `total === 0` return: a mailbox with only held sends has `total` 0.
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
      log.info(`committer ${mailboxId}: SEND_SCOPE=${sendScope.kind}, ${held} approved sends wait`);
    }
  }

  async function openFor(
    ctx: TenantContext,
    mailboxId: string,
    batch: ClaimedAction[],
    now: Date,
    withSender: boolean
  ) {
    try {
      return await openMailboxProvider(deps, ctx, mailboxId, { withSender });
    } catch (error) {
      await release(ctx, batch, now);
      if (error instanceof MailAuthError) {
        await setMailboxStatus(deps.db, ctx, mailboxId, "auth_error", now);
        log.warn(`committer ${mailboxId}: login failed, status is now auth_error`);
      } else if (error instanceof SoftError) {
        log.warn(`committer ${mailboxId}: ${describeError(error)}; the next tick tries again`);
      } else {
        log.error(`committer ${mailboxId}: open failed: ${describeError(error)}`);
      }
      return null;
    }
  }

  // The owner and the organization are read once per tenant and run, and only for a batch with a draft or a send (D12).
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
      organization: { styleText: organization.style_text, timezone: organization.timezone },
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
    appendFolders: ReadonlySet<string>
  ): Promise<void> {
    const mailboxId = mailbox.id;
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
      },
      // A batch without a draft or a send never reads these two.
      owner: facts?.owner ?? { displayName: mailbox.address },
      organization: facts?.organization ?? { styleText: null, timezone: "UTC" },
      compose: deps.compose ?? composeMessage,
      sender,
      hooks: deps.hooks ?? noDelegationHooks,
      appendFolders,
      ...(deps.sendLimits === undefined ? {} : { sendLimits: deps.sendLimits }),
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
          await setMailboxStatus(deps.db, ctx, mailboxId, "auth_error", now);
          log.warn(`committer ${mailboxId}: login failed, status is now auth_error`);
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
        log.error(`committer ${mailboxId}: release failed: ${describeError(releaseError)}`);
      }
      throw error;
    } finally {
      if (counts.applied + counts.failed + counts.retry + counts.closed > 0) {
        const closed = counts.closed > 0 ? `, closed ${counts.closed}` : "";
        const sent = counts.sent > 0 ? `, sent ${counts.sent}` : "";
        log.info(
          `committer ${mailboxId}: applied ${counts.applied}, failed ${counts.failed}, retry ${counts.retry}${closed}${sent}`
        );
      }
    }
  }

  async function processMailbox(ctx: TenantContext, mailboxId: string, facts: Map<string, TenantFacts>): Promise<void> {
    const mailbox = await getMailbox(deps.db, ctx, mailboxId);
    if (mailbox === undefined) return;
    const now = deps.now();
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

    const expired = await expireStale(deps, ctx, mailboxId, now);
    if (expired > 0) log.warn(`committer ${mailboxId}: expired ${expired} stale actions`);

    const sendScope = deps.sendScope ?? { kind: "off" };
    const filter = {
      mailbox: claimFilterFor(deps.scope),
      send: sendFilterFor(sendScope),
    };
    await warnWhenHeldBack(ctx, mailboxId, now);
    await warnWhenSendsHeld(ctx, mailboxId, sendScope, filter.send);
    const { total } = await countClaimable(deps.db, ctx, mailboxId, { now, staleBefore, filter });
    if (total === 0) return;

    const batch = await claimActions(deps.db, ctx, mailboxId, { now, limit: batchSize, staleBefore, filter });
    if (batch.length === 0) return;

    // U11: a move into a `sort` folder is an APPEND transfer. A disabled row counts: its mail can still be undone.
    let appendFolders: ReadonlySet<string> = new Set();
    if (batch.some((action) => needs(action).sortFolders)) {
      try {
        const rows = await listSyncFolders(deps.db, ctx, mailboxId, { enabledOnly: false });
        appendFolders = new Set(rows.filter((row) => row.role === "sort").map((row) => row.path));
      } catch (error) {
        log.error(`committer ${mailboxId}: sync folders failed: ${describeError(error)}`);
        await release(ctx, batch, now).catch((releaseError: unknown) => {
          log.error(`committer ${mailboxId}: release failed: ${describeError(releaseError)}`);
        });
        return;
      }
    }

    let provider: MailProvider | null = null;
    let sender: MailSender | null = null;
    if (batch.some((action) => needs(action).provider)) {
      // The recovery of an `applying` send needs no SMTP (M9).
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
          log.error(`committer ${mailboxId}: facts failed: ${describeError(error)}`);
          await release(ctx, batch, now).catch((releaseError: unknown) => {
            log.error(`committer ${mailboxId}: release failed: ${describeError(releaseError)}`);
          });
          return;
        }
      }
      await applyBatch(ctx, mailbox, batch, provider, sender, now, tenantFacts, appendFolders);
    } finally {
      for (const connection of [provider, sender]) {
        await connection?.close().catch((error: unknown) => {
          log.warn(`committer ${mailboxId}: close failed: ${describeError(error)}`);
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
          // D4: a suspend during the run stops the next mailbox, not only the next run.
          if (await isOrgSuspended(deps.db, { orgId })) continue;
          await processMailbox({ orgId }, mailboxId, facts);
        } catch (error) {
          log.error(`committer ${mailboxId} failed: ${describeError(error)}`);
        }
      }
    },
  };
}
