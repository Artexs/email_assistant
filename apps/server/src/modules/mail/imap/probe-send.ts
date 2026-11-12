// Write probe for the S4 send rules: one synthetic mail through the draft, SMTP, Sent and INBOX paths. Test address only.
import type { FetchMessageObject, FetchQueryObject, ImapFlow } from "imapflow";
import SMTPConnection, { type SMTPConnectionOptions } from "nodemailer/lib/smtp-connection";

import { renderSeedMessage } from "../seed";

import { connectImapClient, type ImapConnectOptions } from "./client";
import { withCleanupNotes } from "./probe";
import { describeFailure } from "./probe-move";
import { createSmtpMarks, smtpConnectOptions, type SmtpConnectionLike, type SmtpConnectOptions } from "./smtp";

const INBOX_PATH = "INBOX";
const DAY_MS = 86_400_000;
const ACTION_HEADER = "x-ea-action-id";
const DEFAULT_POLL_MS = 5000;
const DEFAULT_INBOX_TIMEOUT_MS = 120_000;
const DEFAULT_SENT_TIMEOUT_MS = 60_000;
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
const DRAFT_QUERY: FetchQueryObject = {
  uid: true,
  size: true,
  internalDate: true,
  flags: true,
  envelope: true,
  headers: [ACTION_HEADER],
};

export interface ProbeSendReport {
  capabilities: { uidplus: boolean; pipelining: boolean | null };
  folders: { drafts: string | null; sent: string | null; created: string[] };
  draft: {
    appendUid: number | null;
    searchSinceFound: boolean;
    headerFetched: boolean;
    envelopeMessageId: boolean;
    sizeEqualsRaw: boolean | null;
    internalDateKept: boolean | null;
    flagDraft: boolean | null;
    deleted: boolean;
    goneAfterDelete: boolean | null;
  };
  send: {
    ok: boolean;
    responseCode: number | null;
    dataReplyCode: number | null;
    stage: "connect" | "login" | "envelope" | "content" | "unknown" | null;
    code: string | null;
    lastServerResponseCode: number | null;
  };
  sentCopy: { appendUid: number | null; headerFetched: boolean; searchSinceFound: boolean; deleted: boolean };
  sentAutosave: { foundInSent: boolean; polledSeconds: number };
  inbox: {
    checked: boolean;
    ownMailFound: boolean;
    headerIntact: boolean;
    uid: number | null;
    deleted: boolean;
    polledSeconds: number;
  };
  notes: string[];
}

export interface ProbeSendOptions {
  address: string;
  to: string;
  probeId: string;
  now: Date;
  pollMs?: number;
  inboxTimeoutMs?: number;
  sentTimeoutMs?: number;
  log?: (line: string) => void;
  /** Tests only: a stand-in for the SMTP connection. */
  smtpConnection?: (options: object) => SmtpConnectionLike;
}

/** The recipient is the probe's own address or one of the comma-separated `SEND_TEST_ADDRESSES` (case-insensitive). */
export function isAllowedRecipient(to: string, address: string, envList: string | undefined): boolean {
  const wanted = to.trim().toLowerCase();
  if (wanted === address.trim().toLowerCase()) return true;
  return (envList ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry !== "" && entry === wanted);
}

function newReport(): ProbeSendReport {
  return {
    capabilities: { uidplus: false, pipelining: null },
    folders: { drafts: null, sent: null, created: [] },
    draft: {
      appendUid: null,
      searchSinceFound: false,
      headerFetched: false,
      envelopeMessageId: false,
      sizeEqualsRaw: null,
      internalDateKept: null,
      flagDraft: null,
      deleted: false,
      goneAfterDelete: null,
    },
    send: { ok: false, responseCode: null, dataReplyCode: null, stage: null, code: null, lastServerResponseCode: null },
    sentCopy: { appendUid: null, headerFetched: false, searchSinceFound: false, deleted: false },
    sentAutosave: { foundInSent: false, polledSeconds: 0 },
    inbox: { checked: false, ownMailFound: false, headerIntact: false, uid: null, deleted: false, polledSeconds: 0 },
    notes: [],
  };
}

function leadingCode(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^\d{3}/.exec(value.trim());
  return match ? Number(match[0]) : null;
}

/** The value of the action id header in a fetched header block, or null. */
function actionHeaderOf(message: FetchMessageObject | false): string | null {
  if (message === false || !message.headers) return null;
  const match = new RegExp(`^${ACTION_HEADER}:[ \\t]*(.*)$`, "im").exec(message.headers.toString());
  return match ? (match[1] ?? "").trim() : null;
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

async function searchSince(client: ImapFlow, since: Date): Promise<number[]> {
  const uids = await client.search({ since }, { uid: true });
  return uids === false ? [] : uids;
}

async function appendUid(client: ImapFlow, folder: string, raw: string, flags: string[], now: Date) {
  const appended = await client.append(folder, raw, flags, now);
  return appended === false ? null : (appended.uid ?? null);
}

async function logout(client: ImapFlow): Promise<void> {
  await client.logout().catch(() => client.close());
}

interface Ctx {
  client: ImapFlow;
  report: ProbeSendReport;
  raw: string;
  messageId: string;
  subject: string;
  address: string;
  to: string;
  probeId: string;
  now: Date;
  since: Date;
  say: (line: string) => void;
  /** What to delete by hand when the probe fails; a finished clean-up removes its line. */
  track: (note: string) => () => void;
  step: string;
}

async function resolveFolders(ctx: Ctx): Promise<{ drafts: string; sent: string }> {
  const { client, report } = ctx;
  ctx.step = "list folders";
  const entries = await client.list();
  const pick = async (specialUse: string, fallback: string): Promise<string> => {
    const path = entries.find((entry) => entry.specialUse === specialUse)?.path ?? fallback;
    if (!entries.some((entry) => entry.path === path)) {
      ctx.step = "create folder";
      const created = await client.mailboxCreate(path);
      if (created.created) {
        report.folders.created.push(created.path);
        report.notes.push(`the folder "${created.path}" was created by the probe and stays`);
      }
    }
    return path;
  };
  const drafts = await pick("\\Drafts", "Drafts");
  const sent = await pick("\\Sent", "Sent");
  report.folders.drafts = drafts;
  report.folders.sent = sent;
  ctx.say(`folders: drafts ${drafts}, sent ${sent}, created ${report.folders.created.length}`);
  return { drafts, sent };
}

/** Deletes one uid with `UID EXPUNGE`. Only with UIDPLUS: a plain EXPUNGE would also remove the user's own mail. */
async function deleteUid(client: ImapFlow, folder: string, uid: number): Promise<{ deleted: boolean; gone: boolean }> {
  if (!client.capabilities.has("UIDPLUS")) return { deleted: false, gone: false };
  return inFolder(client, folder, async () => {
    const deleted = await client.messageDelete(String(uid), { uid: true });
    const gone = (await client.fetchOne(String(uid), { uid: true }, { uid: true })) === false;
    return { deleted: deleted && gone, gone };
  });
}

async function runDraft(ctx: Ctx, drafts: string): Promise<void> {
  const { client, report, raw, messageId, probeId, now, since } = ctx;
  const draft = report.draft;
  const forget = ctx.track(`the probe draft "${ctx.subject}" may be in ${drafts}; delete it by hand`);
  ctx.step = "append draft";
  let uid = await appendUid(client, drafts, raw, ["\\Draft"], now);
  draft.appendUid = uid;
  const uidFromSearch = uid === null;

  ctx.step = "search and fetch draft";
  const message = await inFolder(client, drafts, async () => {
    const found = await searchSince(client, since);
    if (uid === null && found.length > 0) {
      uid = Math.max(...found);
      draft.appendUid = uid;
      report.notes.push("the draft uid came from SEARCH, not from APPENDUID");
    }
    draft.searchSinceFound = uid !== null && found.includes(uid);
    return uid === null ? false : client.fetchOne(String(uid), DRAFT_QUERY, { uid: true });
  });
  if (message !== false) {
    draft.headerFetched = actionHeaderOf(message)?.toLowerCase() === probeId.toLowerCase();
    draft.envelopeMessageId = message.envelope?.messageId === messageId;
    draft.sizeEqualsRaw = message.size === Buffer.byteLength(raw);
    draft.internalDateKept =
      message.internalDate === undefined
        ? null
        : Math.floor(new Date(message.internalDate).getTime() / 1000) === Math.floor(now.getTime() / 1000);
    draft.flagDraft = message.flags?.has("\\Draft") ?? null;
  }
  ctx.say(
    `draft: uid ${uid ?? "none"}, since ${draft.searchSinceFound}, header ${draft.headerFetched}, message-id ${draft.envelopeMessageId}, size ${draft.sizeEqualsRaw}, date ${draft.internalDateKept}, flag ${draft.flagDraft}`
  );

  ctx.step = "delete draft";
  if (uid === null) return;
  // A uid from SEARCH alone is a guess: delete it only when it carries the probe's own marks. Else the note stays.
  if (uidFromSearch && !draft.envelopeMessageId && !draft.headerFetched) {
    ctx.say("draft not deleted: the SEARCH uid is not proven to be the probe draft");
    return;
  }
  const result = await deleteUid(client, drafts, uid);
  draft.deleted = result.deleted;
  draft.goneAfterDelete = client.capabilities.has("UIDPLUS") ? result.gone : null;
  if (draft.deleted) forget();
  ctx.say(`draft deleted ${draft.deleted}, gone ${draft.goneAfterDelete}`);
}

interface SendHook {
  logger: object;
  seen: { pipelining: boolean | null; dataReplyCode: number | null };
  contentStarted: () => boolean;
}

/** The logger for the SMTP connection: reads reply codes and the PIPELINING line, stores no text. */
function createSendHook(): SendHook {
  const { marks, logger: base } = createSmtpMarks();
  const seen: SendHook["seen"] = { pipelining: null, dataReplyCode: null };
  const logger: Record<string, (entry?: unknown, message?: unknown) => void> = {};
  for (const level of LOG_LEVELS) {
    logger[level] = (entry, message) => {
      (base as Record<string, (entry?: unknown, message?: unknown) => void>)[level]?.(entry, message);
      const tnx = typeof entry === "object" && entry !== null ? (entry as { tnx?: unknown }).tnx : undefined;
      if (tnx !== "server") return;
      if (!marks.mailFromSent) {
        if (/[ -]PIPELINING\b/i.test(String(message))) seen.pipelining = true;
        else seen.pipelining ??= false;
      } else if (marks.dataSent && seen.dataReplyCode === null && marks.repliesAfterMailFrom === 2 + marks.rcptLines) {
        seen.dataReplyCode = leadingCode(String(message));
      }
    };
  }
  return { logger, seen, contentStarted: () => marks.contentStarted };
}

function stageOfSendError(code: string | null, contentStarted: boolean): "envelope" | "content" | "unknown" {
  if (code === "EENVELOPE") return "envelope";
  if (code === "EMESSAGE") return "content";
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET") {
    return contentStarted ? "unknown" : "envelope";
  }
  return "unknown";
}

function defaultConnection(options: object): SmtpConnectionLike {
  return new SMTPConnection(options as SMTPConnectionOptions) as unknown as SmtpConnectionLike;
}

async function runSend(
  ctx: Ctx,
  smtp: SmtpConnectOptions,
  makeConnection: (options: object) => SmtpConnectionLike
): Promise<void> {
  const { report, raw } = ctx;
  const { auth, ...transport } = await smtpConnectOptions(smtp);
  const hook = createSendHook();
  const connection = makeConnection({
    ...transport,
    name: "ea-mail",
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
    transactionLog: true,
    logger: hook.logger,
  });
  // An `error` event without a listener ends the process: route it into the step that waits, or keep it for the next.
  let pending: ((error: Error) => void) | null = null;
  let early: Error | null = null;
  connection.on("error", (error) => {
    if (pending === null) early ??= error;
    else pending(error);
  });
  type Step = "connect" | "login" | "send";
  const run = <T>(name: Step, start: (done: (error: Error | null | undefined, value?: T) => void) => void) =>
    new Promise<T>((resolve, reject) => {
      const fail = (error: Error) => {
        pending = null;
        reject(Object.assign(error, { probeStep: name }));
      };
      if (early !== null) return fail(early);
      pending = fail;
      start((error, value) => {
        if (error) return fail(error);
        pending = null;
        resolve(value as T);
      });
    });
  ctx.step = "smtp send";
  try {
    await run<undefined>("connect", (done) => connection.connect((error) => done(error)));
    await run<undefined>("login", (done) =>
      connection.login({ user: auth?.user ?? smtp.user, pass: auth?.pass ?? smtp.password }, (error) => done(error))
    );
    const info = await run<{ response: string }>("send", (done) =>
      connection.send({ from: ctx.address, to: [ctx.to] }, Buffer.from(raw), (error, result) => done(error, result))
    );
    report.send.ok = true;
    report.send.responseCode = leadingCode(info.response);
  } catch (error) {
    const fields = (typeof error === "object" && error !== null ? error : {}) as {
      code?: unknown;
      responseCode?: unknown;
      probeStep?: Step;
    };
    const code = typeof fields.code === "string" ? fields.code : null;
    const step = fields.probeStep ?? "send";
    report.send.code = code;
    report.send.responseCode = typeof fields.responseCode === "number" ? fields.responseCode : null;
    report.send.lastServerResponseCode = leadingCode(
      (connection as { lastServerResponse?: unknown }).lastServerResponse
    );
    report.send.stage = step === "send" ? stageOfSendError(code, hook.contentStarted()) : step;
    if (report.send.stage === "content" || report.send.stage === "unknown") {
      report.notes.push("the content phase began: the mail may have been delivered; check the INBOX by hand");
    }
  } finally {
    connection.close();
  }
  report.send.dataReplyCode = hook.seen.dataReplyCode;
  report.capabilities.pipelining = hook.seen.pipelining;
  ctx.say(
    `send: ok ${report.send.ok}, code ${report.send.responseCode ?? "none"}, data reply ${report.send.dataReplyCode ?? "none"}, stage ${report.send.stage ?? "none"}, error ${report.send.code ?? "none"}, last ${report.send.lastServerResponseCode ?? "none"}, pipelining ${report.capabilities.pipelining ?? "unknown"}`
  );
}

async function runSentCopy(ctx: Ctx, sent: string): Promise<void> {
  const { client, report, raw, probeId, now, since } = ctx;
  const copy = report.sentCopy;
  const forget = ctx.track(`the probe copy "${ctx.subject}" may be in ${sent}; delete it by hand`);
  ctx.step = "append Sent copy";
  const uid = await appendUid(client, sent, raw, ["\\Seen"], now);
  copy.appendUid = uid;
  ctx.step = "search and fetch Sent copy";
  await inFolder(client, sent, async () => {
    const found = await searchSince(client, since);
    copy.searchSinceFound = uid !== null && found.includes(uid);
    if (uid === null) return;
    const message = await client.fetchOne(String(uid), { uid: true, headers: [ACTION_HEADER] }, { uid: true });
    copy.headerFetched = actionHeaderOf(message)?.toLowerCase() === probeId.toLowerCase();
  });
  ctx.step = "delete Sent copy";
  if (uid !== null) copy.deleted = (await deleteUid(client, sent, uid)).deleted;
  if (copy.deleted) forget();
  ctx.say(
    `sent copy: uid ${uid ?? "none"}, header ${copy.headerFetched}, since ${copy.searchSinceFound}, deleted ${copy.deleted}`
  );
}

interface PollHit {
  uid: number | null;
  headerIntact: boolean;
  seconds: number;
}

/** Polls `folder` until a mail with the probe id header shows up (not one of `ignore`) or the timeout ends. */
async function pollForProbeMail(
  ctx: Ctx,
  folder: string,
  opts: { timeoutMs: number; pollMs: number; ignore: number[] }
): Promise<PollHit> {
  const { client, probeId, since } = ctx;
  const started = Date.now();
  const checked = new Set<number>(opts.ignore);
  return inFolder(client, folder, async () => {
    for (;;) {
      // NOOP makes the server report mail that arrived after the SELECT.
      await client.noop();
      for (const uid of await searchSince(client, since)) {
        if (checked.has(uid)) continue;
        checked.add(uid);
        const value = actionHeaderOf(
          await client.fetchOne(String(uid), { uid: true, headers: [ACTION_HEADER] }, { uid: true })
        );
        if (value !== null && value.toLowerCase() === probeId.toLowerCase()) {
          return { uid, headerIntact: value === probeId, seconds: Math.round((Date.now() - started) / 1000) };
        }
      }
      const left = opts.timeoutMs - (Date.now() - started);
      if (left <= 0) return { uid: null, headerIntact: false, seconds: Math.round((Date.now() - started) / 1000) };
      await Bun.sleep(Math.min(opts.pollMs, left));
    }
  });
}

async function runSentAutosave(ctx: Ctx, sent: string, opts: { timeoutMs: number; pollMs: number }): Promise<void> {
  ctx.step = "poll Sent";
  const hit = await pollForProbeMail(ctx, sent, {
    ...opts,
    ignore: ctx.report.sentCopy.appendUid === null ? [] : [ctx.report.sentCopy.appendUid],
  });
  ctx.report.sentAutosave = { foundInSent: hit.uid !== null, polledSeconds: hit.seconds };
  if (hit.uid !== null) {
    ctx.track(`the server saved a copy of the probe mail "${ctx.subject}" in ${sent} by itself; delete it by hand`);
  }
  ctx.say(`sent autosave: ${ctx.report.sentAutosave.foundInSent}, polled ${hit.seconds} s`);
}

async function runInbox(ctx: Ctx, opts: { timeoutMs: number; pollMs: number }, forget: () => void): Promise<void> {
  const { client, report } = ctx;
  const inbox = report.inbox;
  inbox.checked = true;
  ctx.step = "poll INBOX";
  const hit = await pollForProbeMail(ctx, INBOX_PATH, { ...opts, ignore: [] });
  inbox.polledSeconds = hit.seconds;
  inbox.ownMailFound = hit.uid !== null;
  inbox.headerIntact = hit.headerIntact;
  inbox.uid = hit.uid;
  ctx.say(`inbox: found ${inbox.ownMailFound}, header ${inbox.headerIntact}, polled ${hit.seconds} s`);
  if (hit.uid === null) return;
  const uid = hit.uid;
  ctx.step = "delete INBOX mail";
  // The INBOX expunge rule (S3): delete only when no other mail of the user is marked \Deleted.
  const others = (
    await inFolder(client, INBOX_PATH, async () => {
      const marked = await client.search({ deleted: true }, { uid: true });
      return marked === false ? [] : marked;
    })
  ).filter((other) => other !== uid);
  if (others.length > 0) {
    ctx.say("inbox mail not deleted: INBOX holds other \\Deleted mail");
    return;
  }
  inbox.deleted = (await deleteUid(client, INBOX_PATH, uid)).deleted;
  if (inbox.deleted) forget();
  ctx.say(`inbox mail deleted ${inbox.deleted}`);
}

/**
 * Performs every IMAP and SMTP write that S4 uses on one synthetic mail and reports facts only.
 * Every write names one UID; the only EXPUNGE is `UID EXPUNGE <uid>`. An error after the first APPEND names what to
 * delete by hand. The caller checks that the address is the test mailbox and `to` is allowed.
 */
export async function probeSend(
  imap: ImapConnectOptions,
  smtp: SmtpConnectOptions,
  opts: ProbeSendOptions
): Promise<ProbeSendReport> {
  const { address, to, probeId, now } = opts;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const domain = address.split("@")[1] ?? "localhost";
  const messageId = `<ea-probe-${probeId}@${domain}>`;
  const subject = `EA probe send ${probeId}`;
  const raw = renderSeedMessage({
    messageId,
    from: address,
    to: [to],
    subject,
    date: now,
    text: "Email assistant send probe. You can delete this mail.",
    headers: { "X-EA-Action-Id": probeId, "X-EA-Probe": probeId },
  });
  const report = newReport();
  const cleanupNotes: string[] = [];
  const client = await connectImapClient(imap);
  const ctx: Ctx = {
    client,
    report,
    raw,
    messageId,
    subject,
    address,
    to,
    probeId,
    now,
    since: new Date(now.getTime() - 2 * DAY_MS),
    say: (line) => opts.log?.(line),
    track: (note) => {
      cleanupNotes.push(note);
      return () => {
        const index = cleanupNotes.indexOf(note);
        if (index >= 0) cleanupNotes.splice(index, 1);
      };
    },
    step: "connect",
  };
  try {
    try {
      report.capabilities.uidplus = client.capabilities.has("UIDPLUS");
      const folders = await resolveFolders(ctx);
      await runDraft(ctx, folders.drafts);
      await runSend(ctx, smtp, opts.smtpConnection ?? defaultConnection);
      if (report.send.ok) {
        // From here on the mail may be in INBOX or at the recipient; only a deleted INBOX copy clears the note.
        const forgetMail = ctx.track(
          `the probe mail "${ctx.subject}" may be in INBOX or at the recipient (${to}); delete it by hand`
        );
        await runSentCopy(ctx, folders.sent);
        await runSentAutosave(ctx, folders.sent, { timeoutMs: opts.sentTimeoutMs ?? DEFAULT_SENT_TIMEOUT_MS, pollMs });
        if (to.trim().toLowerCase() === address.trim().toLowerCase()) {
          await runInbox(ctx, { timeoutMs: opts.inboxTimeoutMs ?? DEFAULT_INBOX_TIMEOUT_MS, pollMs }, forgetMail);
        } else {
          report.notes.push("the recipient is not the probe address: INBOX was not checked");
        }
      }
    } catch (error) {
      throw withCleanupNotes(describeFailure(error, ctx.step), cleanupNotes);
    }
  } finally {
    await logout(client);
  }
  if (cleanupNotes.length > 0) report.notes.push(...cleanupNotes);
  return report;
}
