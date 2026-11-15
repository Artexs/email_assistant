import { toLabMessage, type LabMessage } from "@ea/core";

import type { LabCorpus } from "./corpus";
import { LabMailError, type LabMailClient } from "./mail-client";
import { renderLabMessage } from "./message";
import { injectErrorCounts, slotsToInject, type LabEvent, type LabState, type LoggedLabEvent } from "./state";

// The injector: each planned slot reaches the mailbox of the run once, at its time. SMTP puts the mail into the INBOX;
// a `sent` slot (mail of the executive) is APPENDed into `Sent` with `\Seen`. Exactly once: an `inject_intent` event is on
// disk before the send, an `inject_done` event after it. On a resume, an intent without a done is looked up in every
// folder of the mailbox by Message-ID before any send, because the sim server may have moved the mail out of the INBOX.

export interface InjectorDeps {
  state: LabState;
  mail: LabMailClient;
  spendUsd: () => Promise<number>;
  now: () => Date;
  corpus: LabCorpus;
}

export interface InjectorTick {
  injected: number;
  late: number;
  skipped: number;
  // Set when the spend reached the cap. The tick injects nothing; the serve loop stops the run (only `stopRun` writes `stopped`).
  stopped?: "budget";
}

export const MAX_PER_TICK = 20;
// A slot is late when it goes out more than this long after its planned time.
export const LATE_AFTER_SEC = 120;
// The fifth failure of one slot skips it.
export const MAX_ERRORS_PER_SLOT = 5;

type SkipCode = "smtp_failed" | "append_failed";

function errorCodeOf(error: unknown): string {
  return error instanceof LabMailError ? error.code : "unknown";
}

function intentOf(events: readonly LoggedLabEvent[], slotId: string): LoggedLabEvent | undefined {
  return events.find((event) => event.t === "inject_intent" && event.slotId === slotId);
}

export async function runInjectorTick(deps: InjectorDeps, runId: string): Promise<InjectorTick> {
  const { state, mail, corpus } = deps;
  const run = state.readRun(runId);
  const result: InjectorTick = { injected: 0, late: 0, skipped: 0 };
  const events = state.events(runId);
  if (events.some((event) => event.t === "stopped")) return result;

  if ((await deps.spendUsd()) >= run.capUsd) return { ...result, stopped: "budget" };

  const mailbox = state.readOrgs()[run.org]?.address;
  if (mailbox === undefined) throw new Error(`lab injector: org ${run.org} is not seeded`);

  const tickAt = deps.now();
  const dueIds = run.plan.items.filter((item) => new Date(item.at) <= tickAt).map((item) => item.slotId);
  const queue = slotsToInject(dueIds, events).slice(0, MAX_PER_TICK);
  const planned = new Map(run.plan.items.map((item) => [item.slotId, item.at]));
  const errors = injectErrorCounts(events);

  const skip = (slotId: string, code: SkipCode): void => {
    state.append(runId, { t: "skip", code, ref: slotId });
    result.skipped += 1;
  };

  for (const slotId of queue) {
    const slot = corpus.slots.get(slotId);
    const text = corpus.texts.get(slotId);
    if (slot === undefined || text === undefined) throw new Error(`lab injector: slot ${slotId} is not in the corpus`);
    const message = toLabMessage({
      slot,
      text,
      scenario: corpus.scenario,
      plan: run.plan,
      mailbox,
      parents: corpus.parentsOf(slotId),
    });
    const skipCode: SkipCode = message.kind === "smtp" ? "smtp_failed" : "append_failed";

    // A crash between the fifth `inject_error` and its `skip` leaves a slot that must not be tried again.
    if ((errors.get(slotId) ?? 0) >= MAX_ERRORS_PER_SLOT) {
      skip(slotId, skipCode);
      continue;
    }

    const at = new Date(planned.get(slotId) as string);
    const lateSec = Math.round((tickAt.getTime() - at.getTime()) / 1000);
    const done: LabEvent = {
      t: "inject_done",
      slotId,
      messageId: message.messageId,
      ...(lateSec > LATE_AFTER_SEC ? { lateBySec: lateSec } : {}),
    };

    const resuming = intentOf(events, slotId) !== undefined;
    if (!resuming) state.append(runId, { t: "inject_intent", slotId, messageId: message.messageId });
    // Only the mail client is inside the `try`: a failed write of the state file is not a send error and ends the tick.
    try {
      // The mail is there already when a crash came after the send: no second send.
      const delivered = resuming && (await mail.hasMessageId(mailbox, message.messageId));
      if (!delivered) await send(mail, mailbox, message);
    } catch (error) {
      state.append(runId, { t: "inject_error", slotId, code: errorCodeOf(error) });
      const count = (errors.get(slotId) ?? 0) + 1;
      errors.set(slotId, count);
      if (count >= MAX_ERRORS_PER_SLOT) skip(slotId, skipCode);
      continue;
    }
    state.append(runId, done);
    result.injected += 1;
    if (done.lateBySec !== undefined) result.late += 1;
  }
  return result;
}

async function send(mail: LabMailClient, mailbox: string, message: LabMessage): Promise<void> {
  const raw = renderLabMessage(message);
  if (message.kind === "append_sent") {
    await mail.appendSent(mailbox, raw);
    return;
  }
  // Envelope to = the run mailbox only: the other `to` and `cc` personas get no copy.
  await mail.smtpSend({ envelopeFrom: message.from.address, to: mailbox, raw });
}
