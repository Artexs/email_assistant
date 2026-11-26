// The pure parts of the demo setup (`demo/setup-run.ts` does the work): the mail of the history set, its dates, the plan file and the
// checks of the state that the recording needs. Every refusal is a short code.
import { readFileSync } from "node:fs";

import { DAY_MS, renderNotice } from "@ea/core";

import { renderSeedMessage } from "../../../../server/src/modules/mail";

import type { DemoMail, DemoRunPlan } from "./run-plan";

/** The flags that the steps of the script need. The demo organization has none on after the import. */
export const DEMO_FLAGS_ON = ["trust_ladder", "approvals_page", "delegation_pages", "user_quiet_hours"] as const;
/** With one of these on, the extractor or the drafter calls the replay for mail outside the export, and the run fails on a miss. */
export const DEMO_FLAGS_OFF = ["open_loops", "reply_drafts"] as const;

/** The history mail ends this long before the setup, so the first sync (the last 24 hours) leaves all of it to the backfill. */
export const HISTORY_NEWEST_AGE_MS = 2 * DAY_MS;
/** The longest span of the history set: the backfill reads 30 days and the newest mail is 2 days old. */
export const HISTORY_MAX_SPAN_MS = 25 * DAY_MS;

/** The chat of the owner on the fake Telegram. */
export const DEMO_CHAT_ID = 9_200_001;

/**
 * The raw mail for the INBOX of mailbox B: the sender, subject and text of the seed mail, a synthetic Message-ID
 * (`<demo-<seq>.<runTag>@ea-seed.test>`, so the mail counts as test mail) and `date` as its Date header.
 */
export function demoMessage(mail: DemoMail, opts: { to: string; seq: number; runTag: string; date: Date }): string {
  return renderSeedMessage({
    messageId: `<demo-${opts.seq}.${opts.runTag}@ea-seed.test>`,
    from: mail.from,
    to: [opts.to],
    subject: mail.subject,
    date: opts.date,
    text: mail.text ?? "",
  });
}

/**
 * The dates of the history set on the day of the setup: the offsets between the seed dates stay, the newest mail is 2 days old.
 * Throws `demo_history_span` when the set spans more than 25 days. The result has the order of the input.
 */
export function shiftedDates(seedDates: readonly Date[], now: Date): Date[] {
  if (seedDates.length === 0) return [];
  const times = seedDates.map((date) => date.getTime());
  const newest = Math.max(...times);
  if (newest - Math.min(...times) > HISTORY_MAX_SPAN_MS) throw new Error("demo_history_span");
  const shift = now.getTime() - HISTORY_NEWEST_AGE_MS - newest;
  return times.map((time) => new Date(time + shift));
}

const reviveMail = <T extends DemoMail>(mail: T): T => ({ ...mail, at: new Date(mail.at) });

/** Reads `demo-plan.json` of `prepareDemoRun`: the dates of the mails are ISO strings in the file. */
export function readDemoPlan(file: string): DemoRunPlan {
  const plan = JSON.parse(readFileSync(file, "utf8")) as DemoRunPlan;
  return {
    ...plan,
    history: plan.history.map(reviveMail),
    shadow: plan.shadow.map(reviveMail),
    urgent: reviveMail(plan.urgent),
    delegation: reviveMail(plan.delegation),
    undo: reviveMail(plan.undo),
  };
}

/** The flag lines of `bun run org:flag --list` (`org <id>: <flag> on|off (<source>)`) as flag → on. Other lines are skipped. */
export function parseFlagList(text: string): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const line of text.split("\n")) {
    const found = /^org \S+: (\S+) (on|off)\b/.exec(line.trim());
    if (found?.[1] !== undefined) flags[found[1]] = found[2] === "on";
  }
  return flags;
}

// A fixed line of the notice `autonomy_paused` in each language and detail level, rendered by the product renderer: the line that follows
// the category line (full) or the first line (minimal). A chat message that holds one of them is that notice.
export function pausedNoticeMarkers(): string[] {
  const markers: string[] = [];
  for (const locale of ["en", "pl"] as const) {
    for (const detail of ["full", "minimal"] as const) {
      const view = {
        mailboxId: "00000000-0000-4000-8000-000000000001",
        category: "notification",
        reason: "corrections",
        corrections: 3,
        settingsUrl: null,
      };
      const rendered = renderNotice("autonomy_paused", view, { channel: "telegram", detail, locale });
      if (!rendered.ok) throw new Error("demo_notice_render");
      const lines = rendered.message.text.split("\n");
      markers.push(lines[detail === "full" ? 1 : 0] ?? "");
    }
  }
  return markers.filter((marker) => marker !== "");
}

/** What the state check reads, as the owner sees it. */
export interface SetupState {
  /** Mailbox A as `GET /api/mailboxes` lists it; null when it is missing. */
  mailboxA: { status: string } | null;
  /** The addresses of the mailboxes that the owner sees: B must not be one of them. */
  mailboxAddresses: string[];
  mailboxB: string;
  /** The categories of A with `auto` on. */
  autoCategories: string[];
  /** The texts of the bot messages in the chat of the owner. */
  botTexts: string[];
  flags: Record<string, boolean>;
  telegramLinked: boolean;
  quiet: { start: string | null; end: string | null };
  /** The mails in the INBOX of B. */
  inboxB: number;
  /** The mails of the history set of the plan. */
  historyCount: number;
}

/** The problems of the state, in a fixed order; an empty list means the state is ready for the recording. */
export function setupProblems(state: SetupState): string[] {
  const problems: string[] = [];
  if (state.mailboxA === null) problems.push("setup_a_missing");
  else if (state.mailboxA.status !== "paused") problems.push(`setup_a_status ${state.mailboxA.status}`);
  if (state.autoCategories.length > 0) problems.push(`setup_auto_on ${state.autoCategories.join(",")}`);
  const markers = pausedNoticeMarkers();
  if (state.botTexts.some((text) => markers.some((marker) => text.includes(marker)))) {
    problems.push("setup_autonomy_paused_notice");
  }
  for (const flag of DEMO_FLAGS_ON) if (state.flags[flag] !== true) problems.push(`setup_flag_off ${flag}`);
  for (const flag of DEMO_FLAGS_OFF) if (state.flags[flag] !== false) problems.push(`setup_flag_on ${flag}`);
  if (!state.telegramLinked) problems.push("setup_telegram_not_linked");
  if (state.quiet.start === null || state.quiet.start !== state.quiet.end) problems.push("setup_quiet_hours");
  if (state.inboxB !== state.historyCount) {
    problems.push(`setup_b_inbox ${state.inboxB} expected ${state.historyCount}`);
  }
  if (state.mailboxAddresses.some((address) => address.toLowerCase() === state.mailboxB.toLowerCase())) {
    problems.push("setup_b_connected");
  }
  return problems;
}
