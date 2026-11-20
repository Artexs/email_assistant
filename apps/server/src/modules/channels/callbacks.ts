import {
  parseCallback,
  callbackFamilyOf,
  textsFor,
  type Callback,
  type CallbackFamily,
  type CallbackOfFamily,
  type CoreTexts,
} from "@ea/core";

import type { TenantContext } from "../../platform/db";

import { handleAnsweredTap } from "./answered-taps";
import { handleApprovalCallback, type CallbackDeps } from "./approval-taps";
import { handleDelegateCallback } from "./delegate-taps";
import { handleFeedbackCallback } from "./feedback-taps";
import { handleLoopCallback } from "./loop-taps";
import type { CallbackResult, LinkedChat, TapSource } from "./port";
import { handleReplyCallback } from "./reply-taps";

export type { CallbackDeps } from "./approval-taps";

export interface TapInput {
  deps: CallbackDeps;
  link: LinkedChat;
  ctx: TenantContext;
  texts: CoreTexts;
  tapSource: TapSource;
}

export type CallbackHandler<F extends CallbackFamily> = (
  input: TapInput,
  callback: CallbackOfFamily<F>
) => Promise<CallbackResult>;

export type CallbackHandlers = { [F in CallbackFamily]: CallbackHandler<F> };

// One handler per family; a family in `callbackFamilies` without an entry here fails the typecheck.
// The role, flag and consent checks stay in the handlers.
export const callbackHandlers: CallbackHandlers = {
  feedback: ({ deps, link, ctx, texts }, callback) => handleFeedbackCallback(deps, link, ctx, callback, texts),
  answered: ({ deps, link, ctx, texts }, callback) =>
    handleAnsweredTap({ db: deps.db, ctx, link, now: deps.now(), texts }, callback),
  reply: ({ deps, link, ctx, texts, tapSource }, callback) =>
    handleReplyCallback(deps, link, ctx, callback, texts, tapSource),
  loop: ({ deps, link, ctx, texts, tapSource }, callback) =>
    handleLoopCallback(deps, link, ctx, callback, texts, tapSource),
  delegate: ({ deps, link, ctx, texts }, callback) => handleDelegateCallback(deps, link, ctx, callback, texts),
  approval: ({ deps, link, ctx, texts, tapSource }, callback) =>
    handleApprovalCallback(deps, link, ctx, callback, texts, tapSource),
};

export function dispatchCallback(
  handlers: CallbackHandlers,
  input: TapInput,
  callback: Callback
): Promise<CallbackResult> {
  // Safe: `callbackFamilyOf` returns the family whose union holds this callback, and `handlers[family]` takes that union.
  const handler = handlers[callbackFamilyOf(callback)] as CallbackHandler<CallbackFamily>;
  return handler(input, callback);
}

// The tenant comes from the link. An unknown mail id and a mail of another organization give the same answer.
export async function handleCallback(
  deps: CallbackDeps,
  link: LinkedChat,
  data: string,
  tapSource: TapSource = { messageId: undefined }
): Promise<CallbackResult> {
  const callback = parseCallback(data);
  const texts = textsFor(link.locale);
  if (callback === null) return { answer: texts.bot.taps.invalid };
  const ctx = { orgId: link.orgId, userId: link.userId };
  return dispatchCallback(callbackHandlers, { deps, link, ctx, texts, tapSource }, callback);
}
