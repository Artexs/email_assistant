// Write probes for `mailbox:check --probe` only (a test account): they change the mailbox.
import type { ImapFlow, SearchObject } from "imapflow";

import { HardError, SoftError } from "../../../platform/errors";
import { renderSeedMessage } from "../seed";

import { connectImapClient, toMailError, type ImapConnectOptions } from "./client";
import { sendProbeToSelf, type SmtpConnectOptions } from "./smtp";

const PROBE_HEADER = "X-EA-Probe";
const DEFAULT_POLL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 60_000;

function probeSubject(probeId: string): string {
  return `EA probe ${probeId}`;
}

function byProbeHeader(probeId: string): SearchObject {
  return { header: { [PROBE_HEADER.toLowerCase()]: probeId } };
}

/**
 * Adds the cleanup notes to the error message, so a failed probe still tells what to delete by hand.
 * Keeps SoftError / HardError; the original error is the `cause`.
 */
export function withCleanupNotes(error: unknown, notes: string[]): Error {
  const mapped = toMailError(error, "probe");
  if (notes.length === 0) return mapped;
  const message = `${mapped.message}; ${notes.join("; ")}`;
  return mapped instanceof SoftError
    ? new SoftError(message, { cause: mapped })
    : new HardError(message, { cause: mapped });
}

async function logout(client: ImapFlow): Promise<void> {
  await client.logout().catch(() => client.close());
}

async function searchUids(client: ImapFlow, query: SearchObject): Promise<number[]> {
  const uids = await client.search(query, { uid: true });
  return uids === false ? [] : uids;
}

/**
 * APPENDs one probe draft and checks that `SEARCH HEADER X-EA-Probe <id>` finds it.
 * Deletes the probe only with UIDPLUS: without it, EXPUNGE would also delete the user's own `\Deleted` mail.
 * An error after the APPEND names the probe draft to delete by hand.
 */
export async function probeHeaderSearch(
  imap: ImapConnectOptions,
  draftsFolder: string,
  opts: { uidplus: boolean; probeId: string }
): Promise<{ found: boolean; deleted: boolean }> {
  const { probeId } = opts;
  const raw = renderSeedMessage({
    from: imap.user,
    to: [imap.user],
    subject: probeSubject(probeId),
    date: new Date(),
    text: "Email assistant probe draft. You can delete it.",
    headers: { [PROBE_HEADER]: probeId },
  });
  const client = await connectImapClient(imap);
  try {
    const appended = await client.append(draftsFolder, raw, ["\\Draft"]);
    const lock = await client.getMailboxLock(draftsFolder);
    try {
      const found = await searchUids(client, byProbeHeader(probeId));
      const uid = (appended === false ? undefined : appended.uid) ?? found[0];
      // Both the stored and the live capability must say UIDPLUS, so messageDelete sends UID EXPUNGE.
      const canDelete = opts.uidplus && client.capabilities.has("UIDPLUS") && uid !== undefined;
      const deleted = canDelete ? await client.messageDelete(String(uid), { uid: true }) : false;
      return { found: found.length > 0, deleted };
    } finally {
      lock.release();
    }
  } catch (error) {
    // A failed APPEND can still have stored the draft, so the note says "may be".
    throw withCleanupNotes(error, [
      `the probe draft "${probeSubject(probeId)}" may be in ${draftsFolder}; delete it by hand`,
    ]);
  } finally {
    await logout(client);
  }
}

/**
 * Sends one mail to the mailbox's own address, then looks for it in the Sent folder until the timeout.
 * An error after the send starts names the probe mail to delete by hand.
 */
export async function probeSentAutosave(
  imap: ImapConnectOptions,
  smtp: SmtpConnectOptions,
  address: string,
  sentFolder: string,
  opts: { probeId: string; pollMs?: number; timeoutMs?: number; searchByHeader: boolean }
): Promise<{ saved: boolean }> {
  const { probeId } = opts;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const query = opts.searchByHeader ? byProbeHeader(probeId) : { subject: probeSubject(probeId) };

  try {
    // A failed send can still have delivered the mail, so the note on error says "may be".
    await sendProbeToSelf(smtp, { address, probeId });
    const client = await connectImapClient(imap);
    try {
      const lock = await client.getMailboxLock(sentFolder);
      try {
        for (;;) {
          // NOOP makes the server report mail that arrived after the SELECT.
          await client.noop();
          if ((await searchUids(client, query)).length > 0) return { saved: true };
          const left = deadline - Date.now();
          if (left <= 0) return { saved: false };
          await Bun.sleep(Math.min(pollMs, left));
        }
      } finally {
        lock.release();
      }
    } finally {
      await logout(client);
    }
  } catch (error) {
    throw withCleanupNotes(error, [
      `the probe mail "${probeSubject(probeId)}" may be in INBOX (and ${sentFolder}); delete it by hand`,
    ]);
  }
}
