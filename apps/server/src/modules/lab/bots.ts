import { createHash } from "node:crypto";

import { backOnText, botReplyPlan, botReplyText, botSeed, otherAddressOf, parseLabMessageId } from "@ea/core";
import type { BotEvent, BotReplyPlan, SimPersona } from "@ea/core";
import { simpleParser, type ParsedMail } from "mailparser";

import { INBOX, renderSeedMessage } from "../mail";

import type { LabCorpus } from "./corpus";
import { LabMailError, type LabMailClient } from "./mail-client";
import type { LabEvent, LabState } from "./state";

// The delegate bots. Each delegate persona has an inbox on the sim GreenMail. A tick reads the new mail there, plans
// the reply the slot's `delegateBehaviour` asks for (pure rules: `botReplyPlan`), and sends the replies that are due.
// The bots send only fixed templates, only to the run's mailbox, only from scenario addresses, only through GreenMail.
// Every send writes `bot_intent` first and `bot_done` after, so a restart never sends one reply twice.
export interface BotDeps {
  state: LabState;
  mail: LabMailClient;
  corpus: LabCorpus;
  now: () => Date;
  /** The addresses a bot may send from or to (`labAddresses` plus the `other_address` aliases). */
  allowedAddresses: ReadonlySet<string>;
}

export interface BotTickResult {
  planned: number;
  sent: number;
  unmapped: number;
  unexpected: number;
  failed: number;
}

type SeenEvent = Extract<LabEvent, { t: "seen" }>;
type PlannedEvent = Extract<LabEvent, { t: "bot_planned" }>;

// After this many failed sends of one reply the bot gives up on it (`skip send_failed`), as the injector does for a slot.
export const MAX_ERRORS_PER_REPLY = 5;
// A subject longer than this is cut: a reply header stays far below the 998 character line limit of RFC 5322.
const SUBJECT_LIMIT = 200;
const UID_PART = "uid:";
const MAIL_PART = "mail:";

function delegatesOf(corpus: LabCorpus): SimPersona[] {
  return corpus.scenario.personas.filter((persona) => persona.group === "delegate");
}

/** The addresses the bots own: every delegate address and its `other_address` alias. Mail from them is never read as a delegation. */
function botAddressesOf(corpus: LabCorpus): Set<string> {
  const addresses = new Set<string>();
  for (const persona of delegatesOf(corpus)) {
    addresses.add(persona.address.toLowerCase());
    addresses.add(otherAddressOf(persona.address).toLowerCase());
  }
  return addresses;
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

/** The Message-ID of a bot reply: `r.` and 12 hex chars of the key. It never parses as a lab id. */
function replyMessageId(key: string, senderAddress: string): string {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `<r.${hex}@${domainOf(senderAddress)}>`;
}

function referencesOf(parsed: ParsedMail): string[] {
  const references = parsed.references === undefined ? [] : [parsed.references].flat();
  return parsed.inReplyTo === undefined ? references : [...references, parsed.inReplyTo];
}

function senderAddressOf(parsed: ParsedMail): string | undefined {
  return parsed.from?.value[0]?.address?.toLowerCase();
}

// What the bot knows from the events of the run. It is rebuilt at the start of a tick and kept up to date as the tick writes.
class BotMemory {
  readonly cursor = new Map<string, number>(); // persona key -> last seen UID
  readonly handledIds = new Set<string>(); // Message-IDs of the mail the bot already planned for
  readonly delegationIds = new Map<string, Set<string>>(); // slot id -> Message-IDs of its delegation mail
  readonly handledBySlot = new Map<string, Set<string>>(); // slot id -> every handled Message-ID of the slot
  readonly planned = new Map<string, PlannedEvent>(); // key -> planned reply
  readonly intents = new Set<string>();
  readonly done = new Set<string>();
  readonly errors = new Map<string, number>(); // key -> `bot_error` count
  readonly skipped = new Set<string>(); // refs of `skip` events

  constructor(events: readonly LabEvent[]) {
    for (const event of events) this.note(event);
  }

  note(event: LabEvent): void {
    switch (event.t) {
      case "seen":
        this.noteSeen(event);
        break;
      case "bot_planned":
        this.planned.set(event.key, event);
        break;
      case "bot_intent":
        this.intents.add(event.key);
        break;
      case "bot_done":
        this.done.add(event.key);
        break;
      case "bot_error":
        this.errors.set(event.key, (this.errors.get(event.key) ?? 0) + 1);
        break;
      case "skip":
        this.skipped.add(event.ref);
        break;
      default:
    }
  }

  private noteSeen(event: SeenEvent): void {
    if (event.part.startsWith(UID_PART)) {
      const key = event.part.slice(UID_PART.length);
      this.cursor.set(key, Math.max(this.cursor.get(key) ?? 0, Number(event.ref)));
    } else if (event.part.startsWith(MAIL_PART)) {
      const [slotId, kind] = event.part.slice(MAIL_PART.length).split(":") as [string, BotEvent];
      this.handledIds.add(event.ref);
      addTo(this.handledBySlot, slotId, event.ref);
      if (kind === "delegation") addTo(this.delegationIds, slotId, event.ref);
    }
  }

  // A `done` reply already planned for a mail of this slot: the `late` bot answers once.
  repliedBefore(slotId: string): boolean {
    const ids = this.handledBySlot.get(slotId) ?? new Set<string>();
    for (const planned of this.planned.values()) {
      if (planned.reply.kind !== "done") continue;
      if (ids.has(planned.key.slice(0, planned.key.lastIndexOf(":")))) return true;
    }
    return false;
  }
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

export async function runDelegateBotsTick(deps: BotDeps, runId: string): Promise<BotTickResult> {
  const { state, corpus } = deps;
  const result: BotTickResult = { planned: 0, sent: 0, unmapped: 0, unexpected: 0, failed: 0 };
  const events = state.events(runId);
  if (events.some((event) => event.t === "stopped")) return result;

  const run = state.readRun(runId);
  const org = state.readOrgs()[run.org];
  if (org === undefined) throw new Error(`lab bots: org ${run.org} is not seeded`);

  const memory = new BotMemory(events);
  const write = (event: LabEvent): void => {
    state.append(runId, event);
    memory.note(event);
  };
  const botAddresses = botAddressesOf(corpus);
  const delegates = delegatesOf(corpus);

  for (const persona of delegates) {
    try {
      await readInbox({ deps, runId, persona, memory, write, botAddresses, result });
    } catch (error) {
      // One unreachable delegate inbox must not stop the others or the sends that are due.
      if (!(error instanceof LabMailError)) throw error;
      result.failed += 1;
    }
  }
  await sendDue({ deps, memory, write, delegates, runMailbox: org.address, result });
  return result;
}

interface ReadInput {
  deps: BotDeps;
  runId: string;
  persona: SimPersona;
  memory: BotMemory;
  write: (event: LabEvent) => void;
  botAddresses: ReadonlySet<string>;
  result: BotTickResult;
}

// A new run starts with the newest UID as the cursor, so mail from before the run, or from another run, is never read.
async function readInbox(input: ReadInput): Promise<void> {
  const { deps, persona, memory, write } = input;
  const cursor = memory.cursor.get(persona.key);
  if (cursor === undefined) {
    const newest = await deps.mail.newestUid(persona.address, INBOX);
    write({ t: "seen", part: `${UID_PART}${persona.key}`, ref: String(newest) });
    return;
  }
  for (const message of await deps.mail.fetchSince(persona.address, INBOX, cursor)) {
    await handleMail(input, message);
    write({ t: "seen", part: `${UID_PART}${persona.key}`, ref: String(message.uid) });
  }
}

async function handleMail(input: ReadInput, message: { uid: number; raw: string }): Promise<void> {
  const { deps, runId, persona, memory, write, botAddresses, result } = input;
  const ref = `${persona.key}:${message.uid}`;
  const skip = (code: string): void => write({ t: "skip", code, ref });
  const parsed = await simpleParser(message.raw).catch(() => undefined);
  if (parsed === undefined || parsed.messageId === undefined) {
    skip("unmapped");
    result.unmapped += 1;
    return;
  }
  const from = senderAddressOf(parsed);
  if (from !== undefined && botAddresses.has(from)) return;
  if (memory.handledIds.has(parsed.messageId)) return;
  // RFC 3834: no answer to an automatic mail. The server sets no `Auto-Submitted` on a delegation or a reminder, so
  // the mail a bot must answer never carries one; an automatic mail from the run mailbox would start a loop.
  const autoSubmitted = parsed.headers.get("auto-submitted");
  if (typeof autoSubmitted === "string" && autoSubmitted.trim().toLowerCase() !== "no") {
    skip("auto_submitted");
    return;
  }

  const references = referencesOf(parsed);
  const labIds = references.flatMap((id) => parseLabMessageId(id) ?? []);
  const mine = labIds.filter((id) => id.runId === runId);
  // Mail that only another run's ids reach is not an event of this run.
  if (labIds.length > 0 && mine.length === 0) return;
  const slot = mine.length === 0 ? undefined : deps.corpus.slots.get((mine.at(-1) as { slotId: string }).slotId);
  if (slot === undefined) {
    skip("unmapped");
    result.unmapped += 1;
    return;
  }
  // A clarification the executive's side sent to a delegate's own mail: not a delegation.
  if (slot.persona === persona.key) {
    skip("reply_to_own_mail");
    return;
  }
  if (slot.delegateBehaviour === undefined || slot.expectedDelegate !== persona.key) {
    skip("unexpected_delegation");
    result.unexpected += 1;
    return;
  }

  const earlier = memory.delegationIds.get(slot.id) ?? new Set<string>();
  const event: BotEvent = references.some((id) => earlier.has(id)) ? "reminder" : "delegation";
  const receivedAt = (parsed.date ?? deps.now()).toISOString();
  const plan = botReplyPlan({
    behaviour: slot.delegateBehaviour,
    event,
    receivedAt,
    repliedBefore: memory.repliedBefore(slot.id),
    seed: botSeed(runId, parsed.messageId),
  });
  if (plan !== null) {
    const key = `${parsed.messageId}:${plan.kind}`;
    // A crash between this line and the `seen` event below replays the mail: the key keeps the plan single.
    if (!memory.planned.has(key)) {
      write({ t: "bot_planned", key, at: plan.at, reply: plan, delegate: persona.key, uid: message.uid });
      result.planned += 1;
    }
  }
  write({ t: "seen", part: `${MAIL_PART}${slot.id}:${event}`, ref: parsed.messageId });
}

interface SendInput {
  deps: BotDeps;
  memory: BotMemory;
  write: (event: LabEvent) => void;
  delegates: SimPersona[];
  runMailbox: string;
  result: BotTickResult;
}

async function sendDue(input: SendInput): Promise<void> {
  const { deps, memory, write, result } = input;
  const now = deps.now().getTime();
  for (const planned of [...memory.planned.values()]) {
    if (memory.done.has(planned.key) || memory.skipped.has(planned.key)) continue;
    // A crash between the last `bot_error` and its `skip` lands here: the item ends without a new try.
    if ((memory.errors.get(planned.key) ?? 0) >= MAX_ERRORS_PER_REPLY) {
      write({ t: "skip", code: "send_failed", ref: planned.key });
      continue;
    }
    if (new Date(planned.at).getTime() > now) continue;
    try {
      if (await sendOne(input, planned)) result.sent += 1;
    } catch (error) {
      // The `bot_intent` stays: the next try checks the mailbox and sends again only when the reply is not there.
      write({
        t: "bot_error",
        key: planned.key,
        code: error instanceof BotSendError ? error.code : errorCodeOf(error),
      });
      if ((memory.errors.get(planned.key) ?? 0) >= MAX_ERRORS_PER_REPLY) {
        write({ t: "skip", code: "send_failed", ref: planned.key });
      }
      result.failed += 1;
    }
  }
}

class BotSendError extends Error {
  constructor(readonly code: "render_failed") {
    super(`lab bots: ${code}`);
  }
}

function errorCodeOf(error: unknown): string {
  return error instanceof LabMailError ? error.code : "send_failed";
}

// True when this call sent the reply; false when the reply was there already or the item was skipped.
async function sendOne(input: SendInput, planned: PlannedEvent): Promise<boolean> {
  const { deps, memory, write, runMailbox } = input;
  const persona = input.delegates.find((candidate) => candidate.key === planned.delegate);
  if (persona === undefined) {
    write({ t: "skip", code: "delegate_unknown", ref: planned.key });
    return false;
  }
  const from = planned.reply.from === "self" ? persona.address : otherAddressOf(persona.address);
  const messageId = replyMessageId(planned.key, from);

  // The sim server may have moved the reply out of the INBOX: the check reads every folder.
  if (memory.intents.has(planned.key) && (await deps.mail.hasMessageId(runMailbox, messageId))) {
    write({ t: "bot_done", key: planned.key, messageId });
    return false;
  }

  const received = (await deps.mail.fetchSince(persona.address, INBOX, planned.uid - 1)).find(
    (message) => message.uid === planned.uid
  );
  const parsed = received === undefined ? undefined : await simpleParser(received.raw).catch(() => undefined);
  if (parsed === undefined || parsed.messageId === undefined) {
    write({ t: "skip", code: "received_gone", ref: planned.key });
    return false;
  }
  // After a mailbox reset that changes UIDVALIDITY, a UID can point to another mail: the key of the plan names the
  // Message-ID of the mail it was planned for, so a different mail ends the item.
  if (parsed.messageId !== planned.key.slice(0, planned.key.lastIndexOf(":"))) {
    write({ t: "skip", code: "received_changed", ref: planned.key });
    return false;
  }
  const to = senderAddressOf(parsed);
  const allowed = [from, to].every((address) => address !== undefined && deps.allowedAddresses.has(address));
  if (to !== runMailbox.toLowerCase() || !allowed) {
    write({ t: "skip", code: "address_refused", ref: planned.key });
    return false;
  }

  let raw: string;
  try {
    raw = renderReply({ planned, persona, from, to, messageId, parsed });
  } catch {
    throw new BotSendError("render_failed");
  }
  if (!memory.intents.has(planned.key)) write({ t: "bot_intent", key: planned.key, messageId });
  await deps.mail.smtpSend({ envelopeFrom: from, to, raw });
  write({ t: "bot_done", key: planned.key, messageId });
  return true;
}

interface ReplyInput {
  planned: PlannedEvent;
  persona: SimPersona;
  from: string;
  to: string;
  messageId: string;
  parsed: ParsedMail;
}

// The fixed template in the persona's language; the received mail only gives the threading headers and the subject.
function renderReply(input: ReplyInput): string {
  const { planned, persona, from, to, messageId, parsed } = input;
  const receivedId = parsed.messageId as string;
  const kind: BotReplyPlan["kind"] = planned.reply.kind;
  const receivedAt = (parsed.date ?? new Date(planned.at)).toISOString();
  const text = botReplyText(kind, persona.lang, persona.displayName, backOnText(receivedAt, persona.lang));
  const received = parsed.subject === undefined || parsed.subject.trim() === "" ? text.subject : parsed.subject;
  // A decoded subject may hold a line break: it never goes into a header, and nothing is cut around it.
  if (/[\r\n]/.test(received)) throw new Error("subject holds a line break");
  const subject = [...(/^re:/i.test(received) ? received : `Re: ${received}`)].slice(0, SUBJECT_LIMIT).join("");
  return renderSeedMessage({
    messageId,
    from: `${persona.displayName} <${from}>`,
    to: [to],
    subject,
    date: new Date(planned.reply.at),
    text: text.body,
    inReplyTo: receivedId,
    references: [...(parsed.references === undefined ? [] : [parsed.references].flat()), receivedId],
    headers: kind === "auto_reply" ? { "Auto-Submitted": "auto-replied" } : {},
  });
}
