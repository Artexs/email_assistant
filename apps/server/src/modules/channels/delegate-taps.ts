import {
  cutText,
  withoutEscapeRemains,
  encodeCallback,
  type CoreTexts,
  type DelegateCallback,
  type OutButton,
  type OutMessage,
} from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { listDelegates } from "../delegation";
import { delegateMail } from "../loops";
import { getEmailMeta } from "../mail";
import { isFeatureOn } from "../tenancy";

import type { CallbackDeps } from "./approval-taps";
import type { CallbackResult, LinkedChat } from "./port";

const log = createLog("channels");

export const PICKER_MAX_DELEGATES = 8;
const NAME_MAX = 30;

// The Delegate button and the picker (F116 stage 19, D11, questions.md 6, 13). Owners only. The Delegate button opens one picker
// message with up to 8 active delegates by name; more delegates give a line with the panel link. A pick calls `delegateMail` (it checks
// every rule again under its locks, and the send waits for the owner's tap on the card) and edits the picker to the result line.
// `delegateMail` runs with no caller transaction here: its failure is never caught to commit (stage 16 carry-over).
// The tenant and the user come from the chat link. An unknown mail id and one of another organization get the same answer.
export async function handleDelegateCallback(
  deps: CallbackDeps,
  link: LinkedChat,
  ctx: TenantContext,
  callback: DelegateCallback,
  texts: CoreTexts
): Promise<CallbackResult> {
  const t = texts.loopTaps;
  if (link.role !== "owner") return { answer: t.ownerOnly };
  log.info("tap_received", { kind: callback.kind, user_id: link.userId, email_id: callback.emailId });
  if (callback.kind === "delegate_open") return openPicker(deps, ctx, callback.emailId, texts);

  const result = await delegateMail({ db: deps.db, now: deps.now }, ctx, {
    emailId: callback.emailId,
    delegateId: callback.delegateId,
    userId: link.userId,
    via: "telegram",
  });
  const line = (text: string): CallbackResult => ({ answer: text, edit: { text, buttons: [] } });
  switch (result.kind) {
    case "planned":
      return line(t.delegate.planned);
    case "exists":
      return line(t.delegate.exists);
    case "delegate_inactive":
      return line(t.delegate.delegateInactive);
    case "not_delegable":
      return line(t.delegate.notDelegable);
    case "drafts_off":
      return line(t.delegate.draftsOff);
    case "feature_off":
      return line(t.delegate.featureOff);
    case "not_allowed":
      return { answer: t.ownerOnly };
    case "not_found":
      return { answer: t.notFound };
  }
}

async function openPicker(
  deps: CallbackDeps,
  ctx: TenantContext,
  emailId: string,
  texts: CoreTexts
): Promise<CallbackResult> {
  const t = texts.loopTaps;
  if (!(await isFeatureOn(deps.db, ctx, "delegate_button"))) return { answer: t.delegate.featureOff };
  if ((await getEmailMeta(deps.db, ctx, emailId)) === undefined) return { answer: t.notFound };
  const delegates = await listDelegates(deps.db, ctx, { activeOnly: true, limit: PICKER_MAX_DELEGATES + 1 });
  if (delegates.length === 0) return { answer: t.delegate.noDelegates };
  const shown = delegates.slice(0, PICKER_MAX_DELEGATES);
  const buttons: OutButton[][] = [];
  shown.forEach((delegate, index) => {
    const button = {
      text: cutText(withoutEscapeRemains(delegate.name), NAME_MAX) || cutText(delegate.email, NAME_MAX),
      data: encodeCallback({ kind: "delegate_pick", emailId, delegateId: delegate.id }),
    };
    if (index % 2 === 0) buttons.push([button]);
    else buttons[buttons.length - 1]?.push(button);
  });
  const panel = deps.webBaseUrl === undefined ? null : `${deps.webBaseUrl.replace(/\/+$/, "")}/delegates`;
  const message: OutMessage = {
    text:
      delegates.length > shown.length ? `${t.delegate.pickerTitle}\n${t.delegate.more(panel)}` : t.delegate.pickerTitle,
    buttons,
  };
  return { answer: "", send: message };
}
