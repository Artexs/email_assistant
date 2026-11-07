// Write probe for the S3 move rules: one synthetic mail, every IMAP write the committer will use. Test account only.
import type { FetchMessageObject, ImapFlow } from "imapflow";

import { HardError, SoftError } from "../../../platform/errors";
import { renderSeedMessage, SYNTHETIC_MESSAGE_ID_DOMAIN } from "../seed";

import { connectImapClient, toMailError, type ImapConnectOptions } from "./client";
import { withCleanupNotes } from "./probe";

const INBOX_PATH = "INBOX";
const DAY_MS = 86_400_000;
const FETCH_QUERY = { uid: true, size: true, internalDate: true, envelope: true, flags: true } as const;

export interface ProbeMoveReport {
  delimiter: string | null;
  namespace: { prefix: string; delimiter: string | null };
  capabilities: { move: boolean; uidplus: boolean };
  probeFolder: string;
  /** `null` = not tried. */
  folders: { nested: boolean | null; parentCreateOk: boolean | null };
  append: { uid: number | null };
  copy: { uidMapReturned: boolean; targetUid: number | null; sameUidAsSource: boolean | null };
  targetMeta: {
    found: boolean;
    sameSize: boolean | null;
    sameInternalDate: boolean | null;
    sameEnvelopeDate: boolean | null;
    sameMessageId: boolean | null;
  };
  searchSinceInFolder: { found: boolean };
  expunge: {
    otherDeletedKept: boolean;
    inboxOtherDeleted: number;
    inboxExpungeSkipped: boolean;
    sourceGone: boolean | null;
  };
  moveBack: {
    uidMapReturned: boolean;
    inboxUid: number | null;
    sameAsOriginal: boolean | null;
    aboveUidNext: boolean | null;
  };
  flags: { flaggedKept: boolean; seenKept: boolean; flaggedRemoved: boolean; seenRemoved: boolean };
  cleanup: {
    probeMailDeleted: boolean;
    folderDeleted: boolean;
    parentFolderCreated: boolean;
    parentFolderDeleted: boolean;
  };
  notes: string[];
}

/** Refuses every address except the test mailbox (the same guard as `seedMailbox`). */
export function assertTestAddress(address: string, testAddress: string | undefined): void {
  if (testAddress === undefined) throw new HardError("TEST_MAILBOX_ADDRESS is not set: probe refused");
  if (testAddress.trim().toLowerCase() !== address.trim().toLowerCase()) {
    throw new HardError("the address is not the test mailbox (TEST_MAILBOX_ADDRESS): probe refused");
  }
}

function newReport(): ProbeMoveReport {
  return {
    delimiter: null,
    namespace: { prefix: "", delimiter: null },
    capabilities: { move: false, uidplus: false },
    probeFolder: "",
    folders: { nested: null, parentCreateOk: null },
    append: { uid: null },
    copy: { uidMapReturned: false, targetUid: null, sameUidAsSource: null },
    targetMeta: { found: false, sameSize: null, sameInternalDate: null, sameEnvelopeDate: null, sameMessageId: null },
    searchSinceInFolder: { found: false },
    expunge: { otherDeletedKept: false, inboxOtherDeleted: 0, inboxExpungeSkipped: false, sourceGone: null },
    moveBack: { uidMapReturned: false, inboxUid: null, sameAsOriginal: null, aboveUidNext: null },
    flags: { flaggedKept: false, seenKept: false, flaggedRemoved: false, seenRemoved: false },
    cleanup: { probeMailDeleted: false, folderDeleted: false, parentFolderCreated: false, parentFolderDeleted: false },
    notes: [],
  };
}

function timeOf(value: Date | string | undefined): number | null {
  if (value === undefined) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Runs `fn` with `path` selected, then releases the lock. */
async function inFolder<T>(client: ImapFlow, path: string, fn: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(path);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

async function fetchUid(client: ImapFlow, uid: number): Promise<FetchMessageObject | null> {
  const message = await client.fetchOne(String(uid), FETCH_QUERY, { uid: true });
  return message === false ? null : message;
}

async function searchUids(client: ImapFlow, query: Parameters<ImapFlow["search"]>[0]): Promise<number[]> {
  const uids = await client.search(query, { uid: true });
  return uids === false ? [] : uids;
}

function messageBuilder(probeId: string, address: string, now: Date) {
  return (subject: string, messageId: string) =>
    renderSeedMessage({
      messageId,
      from: address,
      to: [address],
      subject,
      date: now,
      text: "Email assistant move probe. You can delete it.",
      headers: { "X-EA-Probe": probeId },
    });
}

/**
 * Performs every IMAP write that S3 uses (create folder, flags, COPY, UID EXPUNGE, COPY back) on one synthetic mail
 * and reports facts only. Every write names one UID; the only EXPUNGE is `UID EXPUNGE <uid>`, and never in INBOX
 * unless the server proved (in the probe folder) that it expunges only the given UID.
 * An error after the APPEND names the probe mail and folder to delete by hand.
 */
export async function probeMove(
  imap: ImapConnectOptions,
  opts: { probeId: string; now: Date; log?: (line: string) => void }
): Promise<ProbeMoveReport> {
  const { probeId, now } = opts;
  const say = (line: string): void => opts.log?.(line);
  const report = newReport();
  const subject = `EA probe move ${probeId}`;
  const build = messageBuilder(probeId, imap.user, now);
  const notes: string[] = [];
  const ctx: ProbeContext = { probeId, subject, build, now, say, cleanupNotes: notes, step: "connect" };
  const client = await connectImapClient(imap);
  try {
    try {
      await runProbe(client, report, ctx);
    } catch (error) {
      throw withCleanupNotes(describeFailure(error, ctx.step), notes);
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return report;
}

interface ProbeContext {
  probeId: string;
  subject: string;
  build: (subject: string, messageId: string) => string;
  now: Date;
  say: (line: string) => void;
  cleanupNotes: string[];
  /** The step that runs now; it goes into the error message. */
  step: string;
}

/** Keeps only [A-Z0-9-] of an imapflow error field, so no server text reaches the message. */
function safeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.replace(/[^A-Z0-9-]/g, "");
  return token === "" ? null : token;
}

/**
 * Server text of an ALERT: printable characters only, whitespace collapsed, cut to 200 code points. An ALERT is a
 * message of the server to the user, not mail data. Returns the text in quotes, or null when it is empty.
 */
export function sanitizeAlertText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value
    .replace(/[^\P{C}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const text = Array.from(collapsed).slice(0, 200).join("").trim();
  return text === "" ? null : `"${text}"`;
}

/** The quoted alert text of an imapflow error, only when its response code is ALERT (never for other codes). */
function alertTextOf(error: unknown): string | null {
  const fields = (typeof error === "object" && error !== null ? error : {}) as {
    serverResponseCode?: unknown;
    responseText?: unknown;
  };
  return fields.serverResponseCode === "ALERT" ? sanitizeAlertText(fields.responseText) : null;
}

function isNoResponse(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { responseStatus?: unknown }).responseStatus === "NO";
}

/**
 * Names the failed step and the imapflow status fields that hold no mail data. `responseText` is added only for
 * an ALERT, sanitized. Errors that are already Soft/HardError (the probe's own checks) stay as they are.
 */
export function describeFailure(error: unknown, step: string): Error {
  if (error instanceof SoftError || error instanceof HardError) return error;
  const fields = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    responseStatus?: unknown;
    serverResponseCode?: unknown;
  };
  const mapped = toMailError(error, "probe");
  if (mapped instanceof SoftError) return new SoftError(`${mapped.message} at step ${step}`, { cause: error });
  const details = [safeToken(fields.responseStatus), safeToken(fields.serverResponseCode)].filter(
    (token) => token !== null
  );
  const codeText = typeof fields.code === "string" ? ` (${fields.code})` : "";
  const detailText = details.length === 0 ? "" : ` [${details.join(" ")}]`;
  const alert = alertTextOf(error);
  const alertText = alert === null ? "" : ` ${alert}`;
  return new HardError(`IMAP probe failed at step ${step}${codeText}${detailText}${alertText}`, { cause: error });
}

/**
 * Creates the probe folder, which tests D9: the real path of an `AI/*` folder. A server that refuses nested folders
 * (Interia) gets a flat top-level folder `AI-Probe-…` instead; `folders.nested` records which one worked.
 * Returns the folder path and the parent `AI` when the probe created it.
 */
export async function createProbeFolder(
  client: ImapFlow,
  probeName: string,
  report: ProbeMoveReport,
  ctx: Pick<ProbeContext, "step" | "cleanupNotes">
): Promise<{ folder: string; parentFolder: string | null }> {
  ctx.step = "list before create";
  const parentBefore = new Set((await client.list()).map((entry) => entry.path.toLowerCase()));
  ctx.step = "create folder";
  let parentFolder: string | null = null;
  let nestedPossible = true;
  if (!parentBefore.has(`${report.namespace.prefix}AI`.toLowerCase())) {
    try {
      const parent = await client.mailboxCreate("AI");
      report.folders.parentCreateOk = true;
      if (parent.created) {
        parentFolder = parent.path;
        report.cleanup.parentFolderCreated = true;
        ctx.cleanupNotes.push(`the folder "${parent.path}" was created by the probe; delete it by hand if empty`);
      }
    } catch (error) {
      if (!isNoResponse(error)) throw error;
      report.folders.parentCreateOk = false;
      nestedPossible = false;
      report.notes.push(`creating the folder "AI" failed ${alertTextOf(error) ?? "(no alert text)"}`);
    }
  }
  let created: Awaited<ReturnType<ImapFlow["mailboxCreate"]>> | null = null;
  if (nestedPossible) {
    try {
      created = await client.mailboxCreate(["AI", `Probe-${probeName}`]);
      report.folders.nested = true;
    } catch (error) {
      if (!isNoResponse(error)) throw error;
      report.notes.push(`creating a nested folder under "AI" failed ${alertTextOf(error) ?? "(no alert text)"}`);
    }
  }
  if (created === null) {
    created = await client.mailboxCreate(`AI-Probe-${probeName}`);
    report.folders.nested = false;
  }
  if (!created.created) {
    throw new HardError(`the probe folder "${created.path}" already exists: probe refused, nothing was written`);
  }
  const folder = created.path;
  report.probeFolder = folder;
  ctx.cleanupNotes.push(`the probe folder "${folder}" may exist; delete it by hand`);
  return { folder, parentFolder };
}

async function runProbe(client: ImapFlow, report: ProbeMoveReport, ctx: ProbeContext): Promise<void> {
  const { probeId, subject, build, now, say } = ctx;
  const messageId = (tag: string) => `<probe-${probeId}${tag}@${SYNTHETIC_MESSAGE_ID_DOMAIN}>`;
  const hasUidplus = client.capabilities.has("UIDPLUS");

  ctx.step = "list";
  const inbox = (await client.list()).find((entry) => entry.path.toUpperCase() === INBOX_PATH);
  report.delimiter = inbox?.delimiter ?? null;
  const namespace = (client as unknown as { namespace?: { prefix?: string; delimiter?: string } }).namespace;
  report.namespace = { prefix: namespace?.prefix ?? "", delimiter: namespace?.delimiter ?? null };
  report.capabilities = { move: client.capabilities.has("MOVE"), uidplus: hasUidplus };
  say(`delimiter ${report.delimiter ?? "none"}, prefix "${report.namespace.prefix}"`);

  const { folder, parentFolder } = await createProbeFolder(client, probeId.slice(0, 8), report, ctx);
  const folderDelimiter = report.namespace.delimiter ?? report.delimiter;
  say(`probe folder ${folder}, nested ${report.folders.nested}`);

  // APPEND into INBOX; the uid comes from UIDPLUS, else from SEARCH SUBJECT.
  ctx.cleanupNotes.push(`the probe mail "${subject}" may be in INBOX; delete it by hand`);
  ctx.step = "append to INBOX";
  const appended = await client.append(INBOX_PATH, build(subject, messageId("")), []);
  let uid = appended === false ? undefined : appended.uid;
  if (uid === undefined) {
    uid = await inFolder(client, INBOX_PATH, async () => (await searchUids(client, { subject }))[0]);
  }
  if (uid === undefined) throw new HardError("the probe mail was not found in INBOX after the APPEND");
  report.append.uid = uid;
  const originalUid = uid;
  say(`appended uid ${originalUid}`);

  // (1) FETCH the original, (2) flags.
  ctx.step = "fetch and flags in INBOX";
  const original = await inFolder(client, INBOX_PATH, () => fetchUid(client, originalUid));
  if (!original) throw new HardError("the probe mail could not be fetched in INBOX");
  await inFolder(client, INBOX_PATH, async () => {
    if ((await client.messageFlagsAdd(String(originalUid), ["\\Flagged", "\\Seen"], { uid: true })) === false) {
      throw new HardError("STORE +FLAGS failed in INBOX");
    }
    const flags = (await fetchUid(client, originalUid))?.flags;
    report.flags.flaggedKept = flags?.has("\\Flagged") ?? false;
    report.flags.seenKept = flags?.has("\\Seen") ?? false;
  });
  say(`flags: flagged ${report.flags.flaggedKept}, seen ${report.flags.seenKept}`);

  // (3) COPY into the probe folder.
  ctx.step = "copy to probe folder";
  const copied = await inFolder(client, INBOX_PATH, () =>
    client.messageCopy(String(originalUid), folder, { uid: true })
  );
  if (copied === false) throw new HardError("COPY into the probe folder failed");
  report.copy.uidMapReturned = (copied.uidMap?.size ?? 0) > 0;
  let targetUid = copied.uidMap?.get(originalUid) ?? null;
  report.copy.targetUid = targetUid;
  report.copy.sameUidAsSource = targetUid === null ? null : targetUid === originalUid;
  say(`copy: uidMap ${report.copy.uidMapReturned}, same uid ${report.copy.sameUidAsSource}`);

  // (4) compare the copy with the original, (5) SEARCH SINCE in the probe folder.
  ctx.step = "compare copy and search since";
  const copyInfo = await inFolder(client, folder, async () => {
    if (targetUid === null) {
      const all = await searchUids(client, { all: true });
      if (all.length === 1) targetUid = all[0] ?? null;
    }
    return targetUid === null ? null : fetchUid(client, targetUid);
  });
  if (!copyInfo || targetUid === null) throw new HardError("the copy was not found in the probe folder");
  const copyUid: number = targetUid;
  report.targetMeta = {
    found: true,
    sameSize: copyInfo.size === original.size,
    sameInternalDate: timeOf(copyInfo.internalDate) === timeOf(original.internalDate),
    sameEnvelopeDate: timeOf(copyInfo.envelope?.date) === timeOf(original.envelope?.date),
    sameMessageId: copyInfo.envelope?.messageId === original.envelope?.messageId,
  };
  say(
    `target: size ${report.targetMeta.sameSize}, internaldate ${report.targetMeta.sameInternalDate}, envelope date ${report.targetMeta.sameEnvelopeDate}, message-id ${report.targetMeta.sameMessageId}`
  );
  const since = new Date(now.getTime() - 2 * DAY_MS);
  report.searchSinceInFolder.found = await inFolder(client, folder, async () =>
    (await searchUids(client, { since })).includes(copyUid)
  );
  say(`search since in folder: ${report.searchSinceInFolder.found}`);

  // (6a) UID EXPUNGE test in the probe folder only: A is expunged, B must stay.
  // `otherDeletedKept` is true only when every part is proven; a failed part leaves it false and adds a note.
  let uidB: number | null = null;
  ctx.step = "expunge test";
  if (hasUidplus) {
    const subjectA = `${subject} A`;
    const subjectB = `${subject} B`;
    const appendedA = await client.append(folder, build(subjectA, messageId("-a")), []);
    const appendedB = await client.append(folder, build(subjectB, messageId("-b")), []);
    const [uidA, foundB] = await inFolder(client, folder, async () => [
      (appendedA === false ? undefined : appendedA.uid) ?? (await searchUids(client, { subject: subjectA }))[0],
      (appendedB === false ? undefined : appendedB.uid) ?? (await searchUids(client, { subject: subjectB }))[0],
    ]);
    if (uidA === undefined || foundB === undefined) throw new HardError("the expunge test mails were not found");
    uidB = foundB;
    await inFolder(client, folder, async () => {
      const markedA = await client.messageFlagsAdd(String(uidA), ["\\Deleted"], { uid: true });
      const markedB = await client.messageFlagsAdd(String(foundB), ["\\Deleted"], { uid: true });
      const bMarked = (await fetchUid(client, foundB))?.flags?.has("\\Deleted") ?? false;
      if (!markedA || !markedB || !bMarked) {
        report.notes.push("the UID EXPUNGE test did not run: the \\Deleted flag was not set on both test mails");
        return;
      }
      const deletedA = await client.messageDelete(String(uidA), { uid: true });
      const aGone = (await fetchUid(client, uidA)) === null;
      const bStays = (await fetchUid(client, foundB)) !== null;
      if (!deletedA) report.notes.push("UID EXPUNGE of the test mail A failed");
      else if (!aGone) report.notes.push("UID EXPUNGE removed nothing");
      else if (!bStays) report.notes.push("UID EXPUNGE also removed the other \\Deleted test mail B");
      report.expunge.otherDeletedKept = deletedA && aGone && bStays;
      if (!bStays) {
        uidB = null;
      } else if (!(await client.messageFlagsRemove(String(foundB), ["\\Deleted"], { uid: true }))) {
        report.notes.push("the \\Deleted flag of the test mail B was not cleared");
      }
    });
  } else {
    report.notes.push("the server has no UIDPLUS: the UID EXPUNGE test was not run");
  }
  say(`uid expunge keeps the other deleted mail: ${report.expunge.otherDeletedKept}`);

  // INBOX expunge rule: only when the probe folder proved UID EXPUNGE and no other \Deleted mail is in INBOX.
  const inboxExpungeAllowed = async (own: number[]): Promise<boolean> => {
    if (!report.expunge.otherDeletedKept) {
      report.expunge.inboxExpungeSkipped = true;
      const note = "inboxOtherDeleted not measured: the INBOX expunge was skipped";
      if (!report.notes.includes(note)) report.notes.push(note);
      return false;
    }
    const others = (await inFolder(client, INBOX_PATH, () => searchUids(client, { deleted: true }))).filter(
      (n) => !own.includes(n)
    );
    report.expunge.inboxOtherDeleted = Math.max(report.expunge.inboxOtherDeleted, others.length);
    if (others.length > 0) report.expunge.inboxExpungeSkipped = true;
    return others.length === 0;
  };

  // (6b) expunge the original in INBOX.
  ctx.step = "expunge original in INBOX";
  let originalGone = false;
  if (await inboxExpungeAllowed([originalUid])) {
    await inFolder(client, INBOX_PATH, async () => {
      if (!(await client.messageDelete(String(originalUid), { uid: true }))) {
        report.notes.push("UID EXPUNGE of the original probe mail in INBOX failed");
      }
      originalGone = (await fetchUid(client, originalUid)) === null;
    });
    report.expunge.sourceGone = originalGone;
  }
  say(`inbox expunge: skipped ${report.expunge.inboxExpungeSkipped}, source gone ${report.expunge.sourceGone}`);

  // (7) COPY back to INBOX.
  ctx.step = "copy back to INBOX";
  const uidNextBefore = (await client.status(INBOX_PATH, { uidNext: true })).uidNext ?? null;
  const back = await inFolder(client, folder, () => client.messageCopy(String(copyUid), INBOX_PATH, { uid: true }));
  if (back === false) throw new HardError("COPY back into INBOX failed");
  report.moveBack.uidMapReturned = (back.uidMap?.size ?? 0) > 0;
  let inboxUid = back.uidMap?.get(copyUid) ?? null;
  if (inboxUid === null) {
    const found = await inFolder(client, INBOX_PATH, () => searchUids(client, { subject }));
    const fresh = found.filter((n) => originalGone || n !== originalUid);
    inboxUid = fresh.length > 0 ? Math.max(...fresh) : null;
  }
  report.moveBack.inboxUid = inboxUid;
  if (inboxUid === null) throw new HardError("the copy in INBOX was not found");
  if (originalGone) {
    report.moveBack.sameAsOriginal = inboxUid === originalUid;
  } else {
    report.notes.push("not measured: the original probe mail was not expunged");
  }
  report.moveBack.aboveUidNext = uidNextBefore === null ? null : inboxUid >= uidNextBefore;
  say(`move back: uidMap ${report.moveBack.uidMapReturned}, same as original ${report.moveBack.sameAsOriginal}`);

  // (8) remove the flags in INBOX.
  ctx.step = "remove flags in INBOX";
  const backUid: number = inboxUid;
  await inFolder(client, INBOX_PATH, async () => {
    if (!(await client.messageFlagsRemove(String(backUid), ["\\Flagged", "\\Seen"], { uid: true }))) {
      report.notes.push("STORE -FLAGS failed in INBOX");
    }
    const flags = (await fetchUid(client, backUid))?.flags;
    report.flags.flaggedRemoved = !(flags?.has("\\Flagged") ?? true);
    report.flags.seenRemoved = !(flags?.has("\\Seen") ?? true);
  });
  say(`flags removed: flagged ${report.flags.flaggedRemoved}, seen ${report.flags.seenRemoved}`);

  // (9) cleanup. INBOX probe mails go under the INBOX expunge rule; what stays is read back from INBOX.
  ctx.step = "cleanup";
  const inboxProbeUids = originalGone ? [backUid] : [originalUid, backUid];
  for (const own of inboxProbeUids) {
    if (await inboxExpungeAllowed(inboxProbeUids)) {
      await inFolder(client, INBOX_PATH, () => client.messageDelete(String(own), { uid: true }));
    }
  }
  const staying = await inFolder(client, INBOX_PATH, async () => {
    const left: number[] = [];
    for (const own of inboxProbeUids) {
      if (await fetchUid(client, own)) left.push(own);
    }
    return left;
  });
  for (const own of staying) {
    report.notes.push(`the probe mail "${subject}" with UID ${own} stays in INBOX; delete it by hand`);
  }
  report.cleanup.probeMailDeleted = staying.length === 0;

  // The probe folder holds only probe mail. Without UIDPLUS `messageDelete` sends a plain EXPUNGE: never do that;
  // `mailboxDelete` removes the folder with its mail.
  if (hasUidplus) {
    await inFolder(client, folder, async () => {
      for (const own of uidB === null ? [copyUid] : [copyUid, uidB]) {
        await client.messageDelete(String(own), { uid: true });
      }
    });
  } else {
    report.notes.push("the server has no UIDPLUS: the probe folder mails are removed with the folder, not by UID");
  }
  try {
    await client.mailboxDelete(folder);
    report.cleanup.folderDeleted = true;
  } catch (error) {
    report.notes.push(
      `the probe folder "${folder}" stays; delete it by hand (${toMailError(error, "delete").message})`
    );
  }
  await cleanupParent(client, report, parentFolder, folderDelimiter);
  ctx.cleanupNotes.length = 0;
  say(`cleanup: mail deleted ${report.cleanup.probeMailDeleted}, folder deleted ${report.cleanup.folderDeleted}`);
}

/** Deletes the parent folder only when the probe created it, it has no children and no mail (best effort). */
export async function cleanupParent(
  client: ImapFlow,
  report: ProbeMoveReport,
  parent: string | null,
  delimiter: string | null
): Promise<void> {
  if (!report.cleanup.parentFolderCreated || parent === null) return;
  const byHand = `the folder "${parent}" was created by the probe and stays; delete it by hand if empty`;
  try {
    const hasChildren = (await client.list()).some(
      (entry) => delimiter !== null && entry.path.startsWith(`${parent}${delimiter}`)
    );
    const messages = hasChildren ? null : (await client.status(parent, { messages: true })).messages;
    if (hasChildren || messages !== 0) {
      report.notes.push(byHand);
      return;
    }
    await client.mailboxDelete(parent);
    report.cleanup.parentFolderDeleted = true;
  } catch {
    report.notes.push(byHand);
  }
}
