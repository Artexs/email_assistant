import { AI_FOLDER_NAMES, MAILBOX_ACTION_TYPES, type FolderKey } from "@ea/core";
import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError, HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import {
  getMailbox,
  listSyncTargets,
  MailAuthError,
  openMailboxProvider,
  setFolderMapEntry,
  setMailboxStatus,
  type ImapConnectOptions,
  type MailProvider,
} from "../mail";

import { applyAction, type FolderResolver } from "./apply";
import { STALE_AFTER_MS } from "./constants";
import { claimActions, countClaimable, expireStaleReady, releaseActions, type ClaimedAction } from "./repo";
import { claimFilterFor, type ActionsScope } from "./scope";

const log = createLog("actions");

const DEFAULT_BATCH_SIZE = 20;

export interface CommitterDeps {
  db: Db | Transaction<DB>;
  secrets: SecretBox;
  openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
  scope: ActionsScope;
  now(): Date;
  batchSize?: number;
}

// D9: `ensureFolder` once per key per run. A real path that differs from `folder_map` is stored (audit: the key, not the path).
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
  const cache = new Map<FolderKey, Promise<string>>();

  async function ensure(key: FolderKey): Promise<string> {
    const path = await deps.provider.ensureFolder(map[key] ?? AI_FOLDER_NAMES[key]);
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

const isMailboxChanging = (action: ClaimedAction): boolean =>
  (MAILBOX_ACTION_TYPES as readonly string[]).includes(action.type);

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
      filter: { kind: "all" },
    });
    if (held.mailboxChanging > 0) {
      warnedOff.add(mailboxId);
      log.info(`committer: ACTIONS_SCOPE=off, ${held.mailboxChanging} mailbox actions wait in mailbox ${mailboxId}`);
    }
  }

  async function openFor(ctx: TenantContext, mailboxId: string, batch: ClaimedAction[], now: Date) {
    try {
      return await openMailboxProvider(deps, ctx, mailboxId);
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

  async function applyBatch(
    ctx: TenantContext,
    mailboxId: string,
    folderMap: Record<string, string>,
    batch: ClaimedAction[],
    provider: MailProvider | null,
    now: Date
  ): Promise<void> {
    const counts = { applied: 0, failed: 0, retry: 0 };
    const folders: FolderResolver =
      provider === null
        ? { resolve: () => Promise.reject(new HardError("no provider")) }
        : createFolderResolver({ db: deps.db, now: () => now, provider, mailboxId, folderMap }, ctx);
    let index = 0;
    try {
      for (; index < batch.length; index += 1) {
        const action = batch[index] as ClaimedAction;
        const outcome = await applyAction({ db: deps.db, now: () => now, mailboxId, folders }, ctx, action, provider);
        if (outcome.kind === "applied") counts.applied += 1;
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
      if (counts.applied + counts.failed + counts.retry > 0) {
        log.info(`committer ${mailboxId}: applied ${counts.applied}, failed ${counts.failed}, retry ${counts.retry}`);
      }
    }
  }

  async function processMailbox(ctx: TenantContext, mailboxId: string): Promise<void> {
    const mailbox = await getMailbox(deps.db, ctx, mailboxId);
    if (mailbox === undefined) return;
    const now = deps.now();
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

    const expired = await expireStale(deps, ctx, mailboxId, now);
    if (expired > 0) log.warn(`committer ${mailboxId}: expired ${expired} stale actions`);

    const filter = claimFilterFor(deps.scope, mailbox.address);
    await warnWhenHeldBack(ctx, mailboxId, now);
    const { total } = await countClaimable(deps.db, ctx, mailboxId, { now, staleBefore, filter });
    if (total === 0) return;

    const batch = await claimActions(deps.db, ctx, mailboxId, { now, limit: batchSize, staleBefore, filter });
    if (batch.length === 0) return;

    let provider: MailProvider | null = null;
    if (batch.some(isMailboxChanging)) {
      const opened = await openFor(ctx, mailboxId, batch, now);
      if (opened === null) return;
      provider = opened.provider;
    }
    try {
      await applyBatch(ctx, mailboxId, mailbox.folder_map, batch, provider, now);
    } finally {
      await provider?.close().catch((error: unknown) => {
        log.warn(`committer ${mailboxId}: close failed: ${describeError(error)}`);
      });
    }
  }

  return {
    async run() {
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        try {
          await processMailbox({ orgId }, mailboxId);
        } catch (error) {
          log.error(`committer ${mailboxId} failed: ${describeError(error)}`);
        }
      }
    },
  };
}
