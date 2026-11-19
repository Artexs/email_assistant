import { type NoticeKind } from "@ea/core";

import { type TenantContext } from "../../../platform/db";
import { loopConsentOf } from "../consent";
import { planFanOut, type NoticeRecipient } from "../notice-fan-out";

import { DbOrTrx, queue } from "./run";

// The gate of the follow-up notices. A card or a result of a follow-up names recipients of the owner's own
// sent mail: only an owner whose Telegram consent covers open-loop data gets it in Telegram (`loopConsentOf`, the one choke point). The others get
// one fixed line per day and kind, with the panel link: no recipient, no subject, no text.
// The gate guards Telegram. A push holds a kind, a count and an id and no text, so a withheld owner with a live device still gets the
// real kind by push (`pushWithheld`; queue it with `only: "push"`). `covered` get the real kind on every channel of their route.
// `withheld` are the owners that get the fixed line: the ones with a linked chat (a push-only owner has no chat to tell).
export interface LoopGate {
  covered: NoticeRecipient[];
  withheld: NoticeRecipient[];
  pushWithheld: NoticeRecipient[];
}

export async function splitByLoopConsent(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: readonly NoticeRecipient[],
  event: { kind: NoticeKind; eventAt: Date; now: Date }
): Promise<LoopGate> {
  const covers = await loopConsentOf(
    db,
    ctx,
    owners.map((owner) => owner.userId)
  );
  const notCovered = owners.filter((owner) => !covers.has(owner.userId));
  const pushWithheld: NoticeRecipient[] = [];
  for (const owner of notCovered) {
    const plan = await planFanOut(db, ctx, { userId: owner.userId, only: "push", ...event });
    if (plan.deviceIds.length > 0) pushWithheld.push(owner);
  }
  return {
    covered: owners.filter((owner) => covers.has(owner.userId)),
    withheld: notCovered.filter((owner) => owner.hasChat),
    pushWithheld,
  };
}

// One `loop_consent` row per owner, kind and UTC day (the dedup key): ten follow-ups in a day give one line.
export async function queueLoopConsentLines(
  trx: DbOrTrx,
  ctx: TenantContext,
  withheld: readonly NoticeRecipient[],
  input: { about: "approval" | "result"; panelUrl: string | undefined; now: Date }
): Promise<void> {
  const day = input.now.toISOString().slice(0, 10);
  for (const owner of withheld) {
    await queue(
      trx,
      ctx,
      {
        userId: owner.userId,
        locale: owner.locale,
        kind: "loop_consent",
        dedupKey: `loop_consent:${input.about}:${day}`,
        view: { about: input.about, ...(input.panelUrl === undefined ? {} : { panelUrl: input.panelUrl }) },
        only: "telegram",
      },
      input.now
    );
  }
}
