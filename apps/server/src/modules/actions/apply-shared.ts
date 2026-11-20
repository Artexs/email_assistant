// The types and the helper that apply.ts, drafts.ts and send.ts share. It imports none of them, so there is no import cycle.
import type { MoveTarget, OutgoingMessage, SendLimits, SenderProfile } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import type { AuthErrorReason, MailAuthError, MailProvider, MailSender } from "../mail";

import { noApprovalHooks, noLoopHooks, type ApprovalHooks, type DelegationHooks, type LoopHooks } from "./hooks";
import type { ClaimedAction } from "./repo";
import type { SendLimitHit } from "./send-limit";

export type ApplyOutcome =
  | { kind: "applied" }
  | {
      kind: "failed";
      reason:
        | "mail_not_found"
        | "hard_error"
        | "no_provider"
        | "bad_payload"
        | "has_gaps"
        | "smtp_rejected"
        | "smtp_error"
        | "copy_check_error"
        | "outcome_unknown";
    }
  // An `applying` draft whose send ended before the APPEND.
  // `loop_closed`: the loop of a follow-up closed before the APPEND (the draft) or before the SMTP call (the send).
  // `draft_changed`, `draft_missing`: the Drafts copy was edited or is gone before the SMTP call (no mail went out).
  // `answered`, `sent_by_user`, `newer_mail`, `original_moved`: a reply that the pass before the send stopped.
  | {
      kind: "expired";
      reason:
        | "send_closed"
        | "loop_closed"
        | "draft_changed"
        | "draft_missing"
        | "answered"
        | "sent_by_user"
        | "newer_mail"
        | "original_moved";
    }
  | { kind: "retry"; soft: boolean }
  | { kind: "auth_error"; reason?: AuthErrorReason }
  | { kind: "lost" };

// Gives the real path of a folder key. `ensureFolder` runs once per key per run; a path that differs from `folder_map` is stored.
export type ResolvableFolderKey = MoveTarget | "drafts" | "sent";

export interface FolderResolver {
  resolve(key: ResolvableFolderKey): Promise<string>;
}

export interface ApplyDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  mailboxId: string;
  folders: FolderResolver;
  mailbox: {
    address: string;
    capabilities: { uidplus: boolean };
    folderMap: Record<string, string>;
    /** Which sender the mailbox uses. `graph`: the provider saves the Sent copy, so the send never APPENDs one. Absent: `smtp`. */
    sendVia?: "smtp" | "graph";
  };
  owner: { displayName: string };
  organization: { timezone: string };
  /** The profile row of the mailbox (reply drafts): name and signature. Null or absent: no row, so the fallbacks apply. */
  profile?: SenderProfile | null;
  compose(message: OutgoingMessage): Promise<Buffer>;
  sender: MailSender | null;
  hooks: DelegationHooks;
  /** The cards of a send that the committer closes (a changed or a missing Drafts copy). Absent: `noApprovalHooks`. */
  approvalHooks?: ApprovalHooks;
  /** The org flag `draft_copy_check`: a send of every kind compares its Drafts copy first. A reply always compares. Absent: off. */
  copyCheck?: boolean;
  /** The time budget of the Sent pass before a reply send, in ms. Absent: the budget of the Sent sync. A test sets it small. */
  sentBudgetMs?: number;
  /** Open loops: reads the loop of a follow-up and writes its counters. Absent: `noLoopHooks` (a loop is never open). */
  loopHooks?: LoopHooks;
  /** Paths of the mailbox's `sort` rows (enabled or not): a move into one of them is an APPEND transfer (Interia re-sorts a COPY, F12). */
  appendFolders: ReadonlySet<string>;
  /** Test hook: runs after the IMAP change, before the DB transaction. */
  beforeCommit?: () => void | Promise<void>;
  /** Test hooks of the send: before the SMTP call, after the 250, before the Sent copy. A throw is a crash. */
  beforeSend?: () => void | Promise<void>;
  afterSend?: () => void | Promise<void>;
  beforeSentCopy?: () => void | Promise<void>;
  /** Waits between the looks for the provider's Sent copy (`graph` sends). Absent: a real wait. Tests pass a fake. */
  sleep?: (ms: number) => Promise<void>;
  /** The send limits. Absent: `DEFAULT_SEND_LIMITS`. */
  sendLimits?: SendLimits;
  /** Called after the commit of a held send; never awaited, a throw is logged. Absent: no callback. */
  onSendLimited?: (ctx: TenantContext, hit: SendLimitHit) => void;
}

// Runs `run` in the caller's transaction, or in a new one.
export function inTransaction<T>(db: ApplyDeps["db"], run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

/** What the committer opens or loads for a batch that holds a row of this type. */
export interface ApplyNeeds {
  /** An IMAP connection. Without one the row goes back to its status for a later try. */
  provider: boolean;
  /** An SMTP sender, for a row in `approved` only: the recovery of an `applying` send needs none. */
  sender: boolean;
  /** The owner name, the style text and the time zone (`ApplyDeps.owner`, `ApplyDeps.organization`). */
  facts: boolean;
  /** The paths of the `sort` folders (`ApplyDeps.appendFolders`): a move into one is an APPEND transfer. */
  sortFolders: boolean;
}

type ApplyRun<P extends unknown[]> = (
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  ...rest: P
) => Promise<ApplyOutcome>;

export type ApplyHandler =
  | { needs: ApplyNeeds & { provider: false }; run: ApplyRun<[]> }
  | { needs: ApplyNeeds & { provider: true }; run: ApplyRun<[provider: MailProvider]> };

export type ImapHandler = Extract<ApplyHandler, { needs: { provider: true } }>;

// TypeScript does not narrow a union on a nested field (`needs.provider`); this guard does.
export const needsImap = (handler: ApplyHandler): handler is ImapHandler => handler.needs.provider;

/** The outcome of a refused login. A reason (OAuth mailboxes only) goes on to the status writer; a password login has none. */
export function authErrorOutcome(error: MailAuthError): { kind: "auth_error"; reason?: AuthErrorReason } {
  return error.reason === undefined ? { kind: "auth_error" } : { kind: "auth_error", reason: error.reason };
}

/** The approval hooks of a run: the wired ones, or `noApprovalHooks`. */
export const approvalHooksOf = (deps: Pick<ApplyDeps, "approvalHooks">): ApprovalHooks =>
  deps.approvalHooks ?? noApprovalHooks;

/** The loop hooks of a run: the wired ones, or `noLoopHooks`. */
export const loopHooksOf = (deps: Pick<ApplyDeps, "loopHooks">): LoopHooks => deps.loopHooks ?? noLoopHooks;
