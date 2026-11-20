import { DAY_MS, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import type { FlagsOfMessage, MailProvider } from "./port";
import {
  getFlagTarget,
  listFlagTargets,
  touchEmailFlags,
  writeEmailFlags,
  type FlagRead,
  type FlagTarget,
} from "./repo";
import { normalizeMessageId } from "./sync-rules";

// The sync job refreshes the IMAP flags of recent mail on its own connection, at most this often per mailbox.
export const FLAGS_REFRESH_EVERY_MS = 10 * MINUTE_MS;
export const FLAGS_WINDOW_MS = 30 * DAY_MS;
export const FLAGS_RUN_LIMIT = 3_000;
export const FLAGS_CHUNK = 500;

export interface FlagsRefreshDeps {
  db: Db | Transaction<DB>;
  provider: MailProvider;
  now(): Date;
  /** Mail per run; default `FLAGS_RUN_LIMIT`. A test sets it small. */
  runLimit?: number;
  /**
   * Default true: mail that the server did not return is moved to the back of the queue (`checked_at` = now). The history check passes
   * false: it drops the gone mail, so it must not push it behind the regular refresh, whose move finder reads the gone mail of its own run.
   */
  touchGone?: boolean;
}

export interface FlagsRefreshResult {
  checked: number;
  written: number;
  /** Targets whose UID the server did not return (the mail moved or went). */
  notFound: number;
  /** Targets whose UID now names another mail (a UIDVALIDITY change). */
  mismatch: number;
  /** The targets counted in `notFound`, in read order: mail that left its folder (the move finder looks for it). */
  gone: FlagTarget[];
}

const flagNames = { seen: "\\seen", answered: "\\answered", flagged: "\\flagged" } as const;

// The stored mail is the fetched mail when both Message-IDs are set and equal, or when neither is set and the INTERNALDATE is equal to the second.
function sameMail(target: FlagTarget, fetched: FlagsOfMessage): boolean {
  const stored = normalizeMessageId(target.messageId);
  const found = normalizeMessageId(fetched.messageId);
  // One side without a Message-ID cannot show that the UID names the stored mail: a mismatch.
  if (stored !== null || found !== null) return stored !== null && found !== null && stored === found;
  return Math.floor(target.receivedAt.getTime() / 1000) === Math.floor(fetched.internalDate.getTime() / 1000);
}

function hasFlag(flags: string[], name: string): boolean {
  return flags.some((flag) => flag.toLowerCase() === name);
}

export async function refreshFlags(
  deps: FlagsRefreshDeps,
  ctx: TenantContext,
  mailboxId: string
): Promise<FlagsRefreshResult> {
  const now = deps.now();
  const targets = await listFlagTargets(deps.db, ctx, mailboxId, {
    since: new Date(now.getTime() - FLAGS_WINDOW_MS),
    limit: deps.runLimit ?? FLAGS_RUN_LIMIT,
  });
  const byFolder = new Map<string, FlagTarget[]>();
  for (const target of targets) byFolder.set(target.folder, [...(byFolder.get(target.folder) ?? []), target]);

  const result: FlagsRefreshResult = { checked: targets.length, written: 0, notFound: 0, mismatch: 0, gone: [] };
  for (const [folder, inFolder] of byFolder) {
    for (let from = 0; from < inFolder.length; from += FLAGS_CHUNK) {
      const chunk = inFolder.slice(from, from + FLAGS_CHUNK);
      const fetched = new Map(
        (
          await deps.provider.fetchFlagsIn(
            folder,
            chunk.map((target) => target.uid)
          )
        ).map((m) => [m.uid, m])
      );
      const reads: FlagRead[] = [];
      const unread: FlagTarget[] = [];
      for (const target of chunk) {
        const found = fetched.get(target.uid);
        if (found === undefined) {
          result.notFound += 1;
          result.gone.push(target);
          if (deps.touchGone !== false) unread.push(target);
        } else if (!sameMail(target, found)) {
          result.mismatch += 1;
          unread.push(target);
        } else {
          reads.push({
            ...target,
            seen: hasFlag(found.flags, flagNames.seen),
            answered: hasFlag(found.flags, flagNames.answered),
            flagged: hasFlag(found.flags, flagNames.flagged),
          });
        }
      }
      // Each chunk is consistent on its own: no transaction around the chunks.
      result.written += await writeEmailFlags(deps.db, ctx, reads, now);
      // Mail that could not be read moves to the back of the queue; `checked_at` means "last tried".
      await touchEmailFlags(deps.db, ctx, unread, now);
    }
  }
  return result;
}

// What `refreshFlagsOfEmail` found. `read`: the server answered for this UID and the stored flags now equal it (`answered` is the server's
// `\Answered`). `gone`: the UID is not in the folder (the mail moved or went). `mismatch`: the UID now names another mail. `not_found`:
// no such mail in this organization. In the last three nothing was written and the stored flags stand.
export type FlagsOfEmailResult =
  | { kind: "read"; answered: boolean }
  | { kind: "gone" }
  | { kind: "mismatch" }
  | { kind: "not_found" };

// The flag refresh for one mail, on the caller's connection (the pass before a reply send asks the server whether the mail
// is answered). The same read, the same mail check and the same writer as `refreshFlags`; one `fetchFlagsIn` call for one UID.
export async function refreshFlagsOfEmail(
  deps: Pick<FlagsRefreshDeps, "db" | "provider" | "now">,
  ctx: TenantContext,
  emailId: string
): Promise<FlagsOfEmailResult> {
  const target = await getFlagTarget(deps.db, ctx, emailId);
  if (target === undefined) return { kind: "not_found" };
  const found = (await deps.provider.fetchFlagsIn(target.folder, [target.uid])).find((meta) => meta.uid === target.uid);
  if (found === undefined) return { kind: "gone" };
  if (!sameMail(target, found)) return { kind: "mismatch" };
  const answered = hasFlag(found.flags, flagNames.answered);
  await writeEmailFlags(
    deps.db,
    ctx,
    [
      {
        ...target,
        seen: hasFlag(found.flags, flagNames.seen),
        answered,
        flagged: hasFlag(found.flags, flagNames.flagged),
      },
    ],
    deps.now()
  );
  return { kind: "read", answered };
}
