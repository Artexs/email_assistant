import { type TenantContext } from "../../../platform/db";
import { loopConsentOf } from "../consent";
import { type LinkedChat } from "../port";

import { DbOrTrx, queue } from "./run";

// The gate of the follow-up notices (F116 stage 11, D17). A card or a result of a follow-up names recipients of the owner's own
// sent mail: only an owner whose Telegram consent covers open-loop data gets it (`loopConsentOf`, the one choke point). The others get
// one fixed line per day and kind, with the panel link: no recipient, no subject, no text.
export async function splitByLoopConsent(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: readonly LinkedChat[]
): Promise<{ covered: LinkedChat[]; withheld: LinkedChat[] }> {
  const covers = await loopConsentOf(
    db,
    ctx,
    owners.map((owner) => owner.userId)
  );
  return {
    covered: owners.filter((owner) => covers.has(owner.userId)),
    withheld: owners.filter((owner) => !covers.has(owner.userId)),
  };
}

// One `loop_consent` row per owner, kind and UTC day (the dedup key): ten follow-ups in a day give one line.
export async function queueLoopConsentLines(
  trx: DbOrTrx,
  ctx: TenantContext,
  withheld: readonly LinkedChat[],
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
      },
      input.now
    );
  }
}
