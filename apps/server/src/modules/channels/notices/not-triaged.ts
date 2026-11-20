import { isQuietTime, matchSender, DAY_MS } from "@ea/core";

import { listSenderRules } from "../../config";
import { listWaitingFromSenders, listWaitingSenders, type WaitingQuery } from "../../mail";
import { isFeatureOn } from "../../tenancy";
import { listNotTriagedEmailIds } from "../repo";

import { log, queue, warnSkipped, type Detector, type OrgRun } from "./run";

export const NOT_TRIAGED_LOOKBACK_MS = DAY_MS;
// At most this many mails per mailbox get a notice during one run of pauses. A whole-domain whitelist could flood the chat.
export const NOT_TRIAGED_MAX_PER_MAILBOX = 5;

// While the AI is paused, every linked member learns that mail of a VIP or whitelisted
// sender waits. The pause is the in-memory pause of the triage worker (one process, `main.ts`), not the audit rows
// (those are per organization and end a soft pause early). A restart clears the pause, and triage tries again.
// The notice holds the sender address only. The log line holds a count only.
async function detectNotTriaged(run: OrgRun): Promise<void> {
  const { db, ctx, now } = run;
  const degraded = run.deps.degraded;
  if (degraded === undefined || !degraded.pause.isPaused(now)) return;
  const since = degraded.pause.pausedSince();
  if (since === null) return;
  // Mail that still waits when the quiet hours end gets its notice then.
  if (isQuietTime(now, run.timeZone)) return;
  if (!(await isFeatureOn(db, ctx, "degraded_notice"))) return;

  const query: WaitingQuery = {
    receivedSince: new Date(now.getTime() - NOT_TRIAGED_LOOKBACK_MS),
    syntheticOnly: degraded.scope.kind === "synthetic" ? { testMail: degraded.scope.testMail } : false,
  };
  let queued = 0;
  for (const mailbox of run.mailboxes) {
    if (mailbox.status !== "active") continue;
    try {
      const rules = await listSenderRules(db, ctx, mailbox.id);
      const senders = (await listWaitingSenders(db, ctx, mailbox.id, query)).filter(
        (sender) => matchSender(sender, rules).whitelisted
      );
      const waiting = await listWaitingFromSenders(db, ctx, mailbox.id, senders, query);
      if (waiting.length === 0) continue;
      // The cap counts mails. A mail that has rows already stays in the set: a new member still gets its row.
      const noticed = await listNotTriagedEmailIds(db, ctx, mailbox.id, since);
      let free = NOT_TRIAGED_MAX_PER_MAILBOX - noticed.size;
      for (const mail of waiting) {
        if (!noticed.has(mail.id)) {
          if (free <= 0) continue;
          free -= 1;
        }
        for (const member of run.members) {
          try {
            const added = await queue(
              db,
              ctx,
              {
                userId: member.userId,
                locale: member.locale,
                kind: "not_triaged",
                dedupKey: `not_triaged:${mail.id}`,
                emailId: mail.id,
                // The notice is about mail that waits during the pause: the later of the two starts.
                eventAt: new Date(Math.max(since.getTime(), mail.receivedAt.getTime())),
                mailboxId: mailbox.id,
                view: { emailId: mail.id, mailboxId: mailbox.id, sender: mail.fromAddress },
              },
              now
            );
            if (added) queued += 1;
          } catch (error) {
            warnSkipped("not_triaged", mail.id, error);
          }
        }
      }
    } catch (error) {
      warnSkipped("not_triaged", mailbox.id, error);
    }
  }
  if (queued > 0) log.info("not_triaged_run", { count: queued });
}

export const notTriagedDetector: Detector = {
  name: "not_triaged",
  kinds: ["not_triaged"],
  detect: detectNotTriaged,
};
