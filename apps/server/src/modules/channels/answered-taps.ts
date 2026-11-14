import type { AnsweredCallback, CoreTexts } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { isFeatureOn } from "../tenancy";
import { answerAnsweredCheck } from "../triage";

import type { CallbackResult, LinkedChat } from "./port";

export interface AnsweredTapInput {
  db: Db | Transaction<DB>;
  ctx: TenantContext;
  link: LinkedChat;
  now: Date;
  texts: CoreTexts;
}

// The Yes and No taps of the answered check in /review. Any linked member may tap. The tap checks its flag itself: a
// button that was sent before the flag went off writes nothing. The page holds several items, so no message edit.
export async function handleAnsweredTap(input: AnsweredTapInput, tap: AnsweredCallback): Promise<CallbackResult> {
  const { db, ctx, link, now, texts } = input;
  const answers = texts.review.answered;
  if (!(await isFeatureOn(db, ctx, "answered_check"))) return { answer: answers.off };
  const result = await answerAnsweredCheck(db, ctx, {
    emailId: tap.emailId,
    answer: tap.kind === "answered_yes" ? "yes" : "no",
    userId: link.userId,
    now,
  });
  switch (result.kind) {
    case "yes":
      return { answer: answers.savedYes };
    case "no":
      return { answer: answers.savedNo };
    case "already":
      return { answer: answers.already };
    case "not_found":
      return { answer: texts.bot.taps.notFound };
  }
}
