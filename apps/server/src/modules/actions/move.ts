import { locateKeyOf, locateMessage, MailNotFoundError, type MailProvider } from "../mail";

import type { ClaimedAction } from "./repo";

export interface EnsureResult {
  uid: number;
  movedNow: boolean;
  leftoverDeleted: boolean;
}

/** UIDs that other `emails` rows of the same identity hold in each folder: never this row's copy (D3). */
export interface EnsureExclude {
  from: ReadonlySet<number>;
  to: ReadonlySet<number>;
}

interface Hints {
  fromUid: number;
  toUid: number | null;
}

async function ensureOnce(
  provider: MailProvider,
  email: ClaimedAction["email"],
  from: string,
  to: string,
  hints: Hints,
  exclude: EnsureExclude,
  opts: { byAppend: boolean }
): Promise<EnsureResult | null> {
  const target = await locateMessage(provider, to, locateKeyOf(email, hints.toUid), { excludeUids: exclude.to });
  // B1: the source is the target. A second locate would find the same mail, and "both" would expunge the only copy.
  if (from === to) {
    return target === null ? null : { uid: target.uid, movedNow: false, leftoverDeleted: false };
  }
  const source = await locateMessage(provider, from, locateKeyOf(email, hints.fromUid), { excludeUids: exclude.from });

  if (target !== null && source !== null) {
    // A leftover of a COPY before a crash. `false`: it went away in between, which is fine.
    await provider.deleteMessage(from, source.uid);
    return { uid: target.uid, movedNow: false, leftoverDeleted: true };
  }
  if (target !== null) {
    return { uid: target.uid, movedNow: false, leftoverDeleted: false };
  }
  if (source === null) {
    return null;
  }
  const moved = opts.byAppend
    ? await provider.transferByAppend(from, source.uid, to)
    : await provider.moveMessage(from, source.uid, to);
  const located =
    moved.newUid ??
    (await locateMessage(provider, to, locateKeyOf(email, source.uid), { excludeUids: exclude.to }))?.uid ??
    source.uid;
  return { uid: located, movedNow: true, leftoverDeleted: false };
}

/**
 * Makes the mail sit in `to` and nowhere else (D5). `null` = the mail is nowhere.
 * The mail may leave the source between the locate and the move (a user move): one retry of the whole ensure.
 */
export async function ensureMoved(
  provider: MailProvider,
  email: ClaimedAction["email"],
  from: string,
  to: string,
  hints: Hints,
  exclude: EnsureExclude,
  opts: { byAppend: boolean }
): Promise<EnsureResult | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await ensureOnce(provider, email, from, to, hints, exclude, opts);
    } catch (error) {
      if (!(error instanceof MailNotFoundError)) throw error;
    }
  }
  return null;
}
