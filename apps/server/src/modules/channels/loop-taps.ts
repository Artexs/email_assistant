import { encodeCallback, formatDayNumeric, type CoreTexts, type LoopCallback } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { doneLoop, draftFollowUp, dropLoop, laterLoop, reopenLoop } from "../loops";
import { getOrganization } from "../tenancy";

import type { CallbackDeps } from "./approval-taps";
import { editBriefLine, lineEditResult } from "./brief-line-edit";
import type { CallbackResult, LinkedChat, TapSource } from "./port";

const log = createLog("channels");

// The taps on the buttons of a loop line of the brief (F116 stage 19, D11). The tenant and the user come from the chat link, never from
// the callback. The role check comes before any query: Draft, Drop and Reopen are for owners, Done and Later for any linked member. Each
// tap calls the command of stage 14 with `via: "telegram"`; the command checks the right again and every rule under its locks.
// An id that is unknown and an id of another organization get the same answer (`not_found`). The log line holds the kind and the id only.
const OWNER_ONLY: ReadonlySet<LoopCallback["kind"]> = new Set(["loop_follow_up", "loop_drop", "loop_reopen"]);

export async function handleLoopCallback(
  deps: CallbackDeps,
  link: LinkedChat,
  ctx: TenantContext,
  callback: LoopCallback,
  texts: CoreTexts,
  source: TapSource
): Promise<CallbackResult> {
  const t = texts.loopTaps;
  if (OWNER_ONLY.has(callback.kind) && link.role !== "owner") return { answer: t.ownerOnly };
  log.info("tap_received", { kind: callback.kind, user_id: link.userId, loop_id: callback.loopId });
  const commandDeps = { db: deps.db, now: deps.now };
  const input = { loopId: callback.loopId, userId: link.userId, via: "telegram" as const };
  // The line after a change of state: a mark and no buttons. `null` mark with `already`: the state was changed elsewhere, so the
  // buttons only go.
  const edited = async (
    mark: string | null,
    drop: "all" | readonly string[] = "all"
  ): Promise<Pick<CallbackResult, "edit" | "keyboard">> => {
    if (source.messageId === undefined) return {};
    return lineEditResult(
      await editBriefLine(deps.db, ctx, link, { messageId: source.messageId, id: callback.loopId, mark, drop })
    );
  };

  switch (callback.kind) {
    case "loop_follow_up": {
      const result = await draftFollowUp(commandDeps, ctx, input);
      switch (result.kind) {
        case "planned":
          // The card comes from the detector; the line keeps its other buttons, only Draft goes (a second tap would answer `waiting`).
          return {
            answer: t.draft.planned,
            ...(await edited(null, [encodeCallback({ kind: "loop_follow_up", loopId: callback.loopId })])),
          };
        case "would_draft":
          return { answer: t.draft.wouldDraft };
        case "waiting":
          return { answer: t.draft.waiting };
        case "limit_reached":
          return { answer: t.draft.limitReached };
        case "too_soon":
          return { answer: t.draft.tooSoon };
        case "closed":
          return { answer: t.draft.closed, ...(await edited(null)) };
        case "suspicious":
          return { answer: t.draft.suspicious };
        case "drafts_off":
          return { answer: t.draft.draftsOff };
        case "not_allowed":
          return { answer: t.ownerOnly };
        case "feature_off":
          return { answer: t.draft.featureOff };
        case "not_found":
          return { answer: t.notFound };
      }
      break;
    }
    case "loop_later": {
      const result = await laterLoop(commandDeps, ctx, input);
      switch (result.kind) {
        case "ok": {
          const organization = await getOrganization(deps.db, ctx);
          const date = formatDayNumeric(result.dueAt, organization?.timezone ?? "UTC", texts.locale);
          return { answer: t.later.ok(date), ...(await edited(t.marks.later)) };
        }
        case "limit_reached":
          // The line keeps Draft and Done; only Later goes.
          return {
            answer: t.later.limitReached,
            ...(await edited(null, [encodeCallback({ kind: "loop_later", loopId: callback.loopId })])),
          };
        case "closed":
          return { answer: t.later.closed, ...(await edited(null)) };
        case "not_allowed":
          return { answer: t.later.notAllowed };
        case "feature_off":
          return { answer: t.featureOff };
        case "not_found":
          return { answer: t.notFound };
      }
      break;
    }
    case "loop_done":
    case "loop_drop": {
      const done = callback.kind === "loop_done";
      const answers = done ? t.done : t.drop;
      const result = await (done ? doneLoop : dropLoop)(commandDeps, ctx, input);
      switch (result.kind) {
        case "ok":
          return { answer: answers.ok, ...(await edited(done ? t.marks.done : t.marks.drop)) };
        case "already":
          return { answer: answers.already, ...(await edited(null)) };
        case "not_allowed":
          // Done is for any member (the user left the organization since the link); Drop is for owners.
          return { answer: done ? t.notFound : t.ownerOnly };
        case "limit_reached":
        case "not_found":
          return { answer: t.notFound };
      }
      break;
    }
    case "loop_reopen": {
      const result = await reopenLoop(commandDeps, ctx, input);
      switch (result.kind) {
        case "ok":
          return { answer: t.reopen.ok, ...(await edited(t.marks.reopen)) };
        case "already":
          return { answer: t.reopen.already, ...(await edited(null)) };
        case "limit_reached":
        case "not_allowed":
          // The owner check came first, so this is a loop that has no text left or whose Sent tracking is off.
          return { answer: t.reopen.notAllowed, ...(await edited(null)) };
        case "not_found":
          return { answer: t.notFound };
      }
      break;
    }
  }
  return { answer: t.notFound };
}
