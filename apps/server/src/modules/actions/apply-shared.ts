// The types and the helper that apply.ts, drafts.ts and send.ts share. It imports none of them, so there is no import cycle.
import type { MoveTarget, OutgoingMessage } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import type { MailProvider, MailSender } from "../mail";

import type { DelegationHooks } from "./hooks";
import type { ClaimedAction } from "./repo";

export type ApplyOutcome =
  | { kind: "applied" }
  | {
      kind: "failed";
      reason:
        | "mail_not_found"
        | "hard_error"
        | "no_provider"
        | "bad_payload"
        | "smtp_rejected"
        | "smtp_error"
        | "outcome_unknown";
    }
  // An `applying` draft whose send ended before the APPEND (N12).
  | { kind: "expired"; reason: "send_closed" }
  | { kind: "retry"; soft: boolean }
  | { kind: "auth_error" }
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
  mailbox: { address: string; capabilities: { uidplus: boolean }; folderMap: Record<string, string> };
  owner: { displayName: string };
  organization: { styleText: string | null; timezone: string };
  compose(message: OutgoingMessage): Promise<Buffer>;
  sender: MailSender | null;
  hooks: DelegationHooks;
  /** Paths of the mailbox's `sort` rows (enabled or not): a move into one of them is an APPEND transfer (Interia re-sorts a COPY, F12). */
  appendFolders: ReadonlySet<string>;
  /** Test hook: runs after the IMAP change, before the DB transaction. */
  beforeCommit?: () => void | Promise<void>;
  /** Test hooks of the send (D11): before the SMTP call, after the 250, before the Sent copy. A throw is a crash. */
  beforeSend?: () => void | Promise<void>;
  afterSend?: () => void | Promise<void>;
  beforeSentCopy?: () => void | Promise<void>;
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
