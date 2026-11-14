import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import type { FlagsOfMessage, MailProvider } from "./port";
import { listFlagTargets, writeEmailFlags, type FlagRead, type FlagTarget } from "./repo";
import { normalizeMessageId } from "./sync-rules";

// D6: the sync job refreshes the IMAP flags of recent mail on its own connection, at most this often per mailbox.
export const FLAGS_REFRESH_EVERY_MS = 10 * 60_000;
export const FLAGS_WINDOW_MS = 30 * 24 * 3_600_000;
export const FLAGS_RUN_LIMIT = 3_000;
export const FLAGS_CHUNK = 500;

export interface FlagsRefreshDeps {
  db: Db | Transaction<DB>;
  provider: MailProvider;
  now(): Date;
}

export interface FlagsRefreshResult {
  checked: number;
  written: number;
  /** Targets whose UID the server did not return (the mail moved or went). */
  notFound: number;
  /** Targets whose UID now names another mail (a UIDVALIDITY change, cold review N3). */
  mismatch: number;
}

const flagNames = { seen: "\\seen", answered: "\\answered", flagged: "\\flagged" } as const;

// The stored mail is the fetched mail when both Message-IDs are set and equal; else the INTERNALDATE equal to the second.
function sameMail(target: FlagTarget, fetched: FlagsOfMessage): boolean {
  const stored = normalizeMessageId(target.messageId);
  const found = normalizeMessageId(fetched.messageId);
  if (stored !== null && found !== null) return stored === found;
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
    limit: FLAGS_RUN_LIMIT,
  });
  const byFolder = new Map<string, FlagTarget[]>();
  for (const target of targets) byFolder.set(target.folder, [...(byFolder.get(target.folder) ?? []), target]);

  const result: FlagsRefreshResult = { checked: targets.length, written: 0, notFound: 0, mismatch: 0 };
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
      for (const target of chunk) {
        const found = fetched.get(target.uid);
        if (found === undefined) {
          result.notFound += 1;
        } else if (!sameMail(target, found)) {
          result.mismatch += 1;
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
    }
  }
  return result;
}
