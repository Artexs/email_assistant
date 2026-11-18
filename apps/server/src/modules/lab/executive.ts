import {
  cardsOf,
  deriveSeed,
  executiveDecision,
  executiveTapAt,
  parseLabMessageId,
  sendPayloadSchema,
  type ExecAction,
  type ExecCard,
  type ExecTruth,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { getSend, getSetSend, listActionsForEmails } from "../actions";
import { getEmailMeta } from "../mail";

import type { LabCorpus } from "./corpus";
import { FakeTgError, type FakeMessage, type FakeTgClient } from "./fake-tg";
import type { LabState, LoggedLabEvent } from "./state";

// The driver of the scripted executive: it reads the run org's fake Telegram chat, finds the slot behind each
// card, plans the press of the stage 09 rules and presses it at its time, at most once (plan.md § Design decisions, exactly once).
//
// Events (all in `events.jsonl`): `seen` (part `tg`, ref = the newest message id read), `tap_planned`, `tap_intent`,
// `tap_done`, and `skip` with the codes `unmapped`, `no_rule`, `tap_repeat`, `tap_unsure`, `tap_gone`, `fake_restarted`.
// They hold ids and codes: never a card text, a subject or an address.
//
// The first tick of a run reads nothing: it stores the newest message id as the seen id (old cards of a reused chat are never read). The serve loop must call
// a tick before the injector sends its first mail.
export const SEEN_PART = "tg";

export interface ExecutiveDeps {
  state: LabState;
  tg: FakeTgClient;
  db: Db;
  now: () => Date;
  corpus: LabCorpus;
}

export interface ExecutiveTickResult {
  planned: number;
  pressed: number;
  unmapped: number;
  noRule: number;
}

export interface CardLookup {
  messageId: string; // the Message-ID header of the mail behind the card
  draft?: ExecCard["draft"];
  moved?: boolean;
}

/**
 * The DB facts behind one card: the Message-ID of its mail and, for an approval, the draft kind and recipient; for a
 * feedback card, whether an automatic move out of the INBOX is applied and not undone. `null`: no such row in this
 * organization (the card is not a card of this org). Every read below filters by `ctx.orgId`.
 */
export async function lookupCard(
  db: Db,
  ctx: TenantContext,
  card: { actionId?: string; setId?: string; emailId?: string }
): Promise<CardLookup | null> {
  const send =
    card.actionId !== undefined
      ? await getSend(db, ctx, card.actionId)
      : card.setId !== undefined
        ? await getSetSend(db, ctx, card.setId)
        : undefined;
  if (send !== undefined) {
    // A follow-up has no incoming mail: the lab scores cards of mail only.
    const messageId = send.email?.message_id_header ?? null;
    if (messageId === null) return null;
    const payload = sendPayloadSchema.safeParse(send.payload);
    if (!payload.success) return { messageId };
    const kind =
      payload.data.kind === "reminder" || payload.data.kind === "follow_up" || payload.data.kind === "reply"
        ? "other"
        : payload.data.kind;
    return { messageId, draft: { kind, recipient: payload.data.to[0] ?? "" } };
  }
  if (card.emailId === undefined) return null;
  const meta = await getEmailMeta(db, ctx, card.emailId);
  if (meta === undefined || meta.message_id_header === null) return null;
  // `now` only sets the `waiting` flag of a send view, which the executive ignores.
  const views = (await listActionsForEmails(db, ctx, [card.emailId], new Date(0))).get(card.emailId) ?? [];
  const moved = views.some(
    (view) =>
      view.type === "move" &&
      !view.reverse &&
      view.status === "applied" &&
      view.folder !== null &&
      view.folder !== "inbox"
  );
  return { messageId: meta.message_id_header, moved };
}

type PlannedEvent = Extract<LoggedLabEvent, { t: "tap_planned" }>;

// What the event log says about the executive so far.
interface Book {
  seen: number | undefined;
  planned: Map<string, PlannedEvent>;
  plannedData: Set<string>;
  intents: Set<string>;
  done: Map<string, LoggedLabEvent>;
  skipRefs: Set<string>; // `${code}:${ref}`
  closed: Set<string>; // taps that end without a press: `tap_unsure` and `tap_gone`
}

function bookOf(events: readonly LoggedLabEvent[]): Book {
  const book: Book = {
    seen: undefined,
    planned: new Map(),
    plannedData: new Set(),
    intents: new Set(),
    done: new Map(),
    skipRefs: new Set(),
    closed: new Set(),
  };
  for (const event of events) {
    switch (event.t) {
      case "seen":
        if (event.part === SEEN_PART) book.seen = Number(event.ref);
        break;
      case "tap_planned":
        book.planned.set(event.key, event);
        book.plannedData.add(event.data);
        break;
      case "tap_intent":
        book.intents.add(event.key);
        break;
      case "tap_done":
        book.done.set(event.key, event);
        break;
      case "skip":
        book.skipRefs.add(`${event.code}:${event.ref}`);
        if (event.code === "tap_unsure" || event.code === "tap_gone") book.closed.add(event.ref);
        break;
      default:
        break;
    }
  }
  return book;
}

const REASON_CODE = { reason_wrong_person: "p", reason_not_needed: "n" } as const;

// The slot truth behind a mail. A Message-ID of another run, or of no lab slot, has none.
function truthOf(deps: ExecutiveDeps, runId: string, messageId: string): ExecTruth {
  const parsed = parseLabMessageId(messageId);
  if (parsed === null || parsed.runId !== runId) return null;
  const slot = deps.corpus.slots.get(parsed.slotId);
  if (slot === undefined) return null;
  const delegate =
    slot.expectedDelegate === undefined
      ? undefined
      : deps.corpus.scenario.personas.find((persona) => persona.key === slot.expectedDelegate)?.address;
  return {
    category: slot.category,
    ...(slot.expectedDraft === undefined ? {} : { expectedDraft: slot.expectedDraft }),
    ...(delegate === undefined ? {} : { expectedDelegateAddress: delegate }),
  };
}

const idOfCard = (card: ExecCard): string => card.actionId ?? card.setId ?? card.emailId ?? "";
const buttonsOf = (message: FakeMessage): string[] => message.buttons.flat().map((button) => button.data);

export async function runExecutiveTick(deps: ExecutiveDeps, runId: string): Promise<ExecutiveTickResult> {
  const { state, tg } = deps;
  const result: ExecutiveTickResult = { planned: 0, pressed: 0, unmapped: 0, noRule: 0 };
  const run = state.readRun(runId);
  const org = state.readOrgs()[run.org];
  if (org === undefined) throw new Error("lab executive: the org of the run is not seeded");
  const ctx: TenantContext = { orgId: org.orgId };
  // The only chat this executive reads or presses in. A tap names no chat of its own.
  const { chatId } = org;
  if (state.events(runId).some((event) => event.t === "stopped")) return result;

  // Resume: a tap with an intent and no done may have reached the server. Never press it again, of any kind.
  const before = bookOf(state.events(runId));
  for (const key of before.intents) {
    if (before.done.has(key) || before.closed.has(key)) continue;
    state.append(runId, { t: "skip", code: "tap_unsure", ref: key });
  }

  const book = bookOf(state.events(runId));
  const hasChat = await tg.hasChat(chatId);
  const messages = hasChat ? await tg.read(chatId) : [];
  const newest = messages.reduce((max, message) => Math.max(max, message.messageId), 0);

  if (!hasChat || (book.seen !== undefined && newest < book.seen)) {
    // A restarted fake holds no chat, or starts its ids again. `lab seed` repairs the chat. A dead chat is
    // reported once: the seen id is 0 afterwards and a later tick adds nothing.
    const quiet = !hasChat && book.seen === 0 && book.skipRefs.has(`fake_restarted:${chatId}`);
    if (!quiet) state.append(runId, { t: "skip", code: "fake_restarted", ref: String(chatId) });
    if (book.seen !== newest) state.append(runId, { t: "seen", part: SEEN_PART, ref: String(newest) });
  } else if (book.seen === undefined) {
    // A run starts at the newest id, so old cards of a reused chat are never read.
    state.append(runId, { t: "seen", part: SEEN_PART, ref: String(newest) });
  } else {
    const input: PlanInput = { runId, ctx, messages, result };
    for (const message of messages) {
      if (message.from !== "bot" || message.messageId <= book.seen) continue;
      for (const card of cardsOf(message.messageId, buttonsOf(message))) {
        await planCard(deps, input, card, { cardAt: deps.now() });
      }
    }
    if (newest > book.seen) state.append(runId, { t: "seen", part: SEEN_PART, ref: String(newest) });
    await planReasons(deps, input);
  }

  await pressDue(deps, runId, chatId, result);
  return result;
}

interface PlanInput {
  runId: string;
  ctx: TenantContext;
  messages: readonly FakeMessage[];
  result: ExecutiveTickResult;
}

// A reject edits the approval message in place. After the `ar:` press, the same message id carries the `rw:` buttons.
// The reason comes from the `then` of the `ar:` event, so a restart between the two presses loses nothing.
async function planReasons(deps: ExecutiveDeps, input: PlanInput): Promise<void> {
  const book = bookOf(deps.state.events(input.runId));
  for (const planned of book.planned.values()) {
    const done = book.done.get(planned.key);
    if (planned.then === undefined || !planned.data.startsWith("ar:") || done === undefined) continue;
    const actionId = planned.data.slice("ar:".length);
    if (book.plannedData.has(`rw:${planned.then}:${actionId}`)) continue;
    const message = input.messages.find((candidate) => candidate.messageId === planned.messageId);
    if (message === undefined) continue;
    const card = cardsOf(message.messageId, buttonsOf(message)).find(
      (candidate) => candidate.kind === "reject_reason" && candidate.actionId === actionId
    );
    // The server has not edited the message yet: look again at the next tick.
    if (card === undefined) continue;
    await planCard(deps, input, card, { cardAt: new Date(done.loggedAt), pendingReason: planned.then });
  }
}

async function planCard(
  deps: ExecutiveDeps,
  input: PlanInput,
  card: ExecCard,
  when: { cardAt: Date; pendingReason?: "p" | "n" }
): Promise<void> {
  const { state, db } = deps;
  const { runId, ctx, result } = input;
  const book = bookOf(state.events(runId));
  const ref = `${when.pendingReason === undefined ? "" : "rw:"}${card.messageId}:${idOfCard(card)}`;
  const skip = (code: "unmapped" | "no_rule"): void => {
    if (book.skipRefs.has(`${code}:${ref}`)) return;
    state.append(runId, { t: "skip", code, ref });
    if (code === "unmapped") result.unmapped += 1;
    else result.noRule += 1;
  };

  // A card the rules never act on needs no lookup.
  if (card.kind === "other") return skip("no_rule");
  const looked = await lookupCard(db, ctx, card);
  const truth = looked === null ? null : truthOf(deps, runId, looked.messageId);
  const full: ExecCard = {
    ...card,
    ...(looked?.draft === undefined ? {} : { draft: looked.draft }),
    ...(looked?.moved === undefined ? {} : { moved: looked.moved }),
  };
  const action: ExecAction = executiveDecision(full, truth, {
    sentAgain: book.plannedData.has(`ag:${card.actionId ?? ""}`),
    ...(when.pendingReason === undefined ? {} : { pendingReason: when.pendingReason }),
  });
  if (action.press === null) {
    if (action.count !== undefined) skip(action.count);
    return;
  }

  const key = `${card.messageId}:${action.press}`;
  if (book.planned.has(key)) return;
  // The same button data names the same action or mail again (a later digest lists a mail again): one press is enough.
  if (book.plannedData.has(action.press)) {
    if (!book.skipRefs.has(`tap_repeat:${key}`)) state.append(runId, { t: "skip", code: "tap_repeat", ref: key });
    return;
  }
  const at = executiveTapAt(when.cardAt.toISOString(), deriveSeed(0, `${runId}:${key}`));
  state.append(runId, {
    t: "tap_planned",
    key,
    at,
    data: action.press,
    messageId: card.messageId,
    ...(action.then === undefined ? {} : { then: REASON_CODE[action.then] }),
  });
  result.planned += 1;
}

// The intent is on disk before the press. A failed press with a 4xx answer did nothing (the button is gone): it
// closes the tap with `tap_gone`. Any other failure leaves the intent open, and the next tick closes it as `tap_unsure`.
async function pressDue(
  deps: ExecutiveDeps,
  runId: string,
  chatId: number,
  result: ExecutiveTickResult
): Promise<void> {
  const { state, tg, now } = deps;
  const book = bookOf(state.events(runId));
  const due = [...book.planned.values()]
    .filter((tap) => !book.intents.has(tap.key) && Date.parse(tap.at) <= now().getTime())
    .sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  for (const tap of due) {
    state.append(runId, { t: "tap_intent", key: tap.key, data: tap.data });
    try {
      await tg.press(chatId, tap.messageId, tap.data);
    } catch (error) {
      if (error instanceof FakeTgError && error.status >= 400 && error.status < 500) {
        state.append(runId, { t: "skip", code: "tap_gone", ref: tap.key });
      }
      continue;
    }
    state.append(runId, { t: "tap_done", key: tap.key, data: tap.data });
    result.pressed += 1;
  }
}
