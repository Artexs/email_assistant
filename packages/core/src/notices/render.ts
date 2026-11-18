import type { z } from "zod";

import { approvalEdit } from "../digest/approvals";
import { MESSAGE_MAX_CHARS, type OutMessage, outButtonsSchema } from "../digest/message";
import { textsFor } from "../texts";

import type { NoticeKind, NoticeRenderOptions } from "./kinds";
import { type NoticeRenderer, noticeRenderers } from "./renderers";

export type NoticeRenderResult = { ok: true; message: OutMessage } | { ok: false };

// Never throws: a view its schema rejects, a renderer that throws, an empty or too long text, bad buttons → { ok: false }.
// `text.length` counts UTF-16 units, so it is never below Postgres `char_length`: the DB CHECK cannot fail after this check.
export function renderNotice(kind: NoticeKind, view: unknown, opts: NoticeRenderOptions): NoticeRenderResult {
  const renderer: NoticeRenderer<z.ZodType> = noticeRenderers[kind];
  const parsed = renderer.schema.safeParse(view);
  if (!parsed.success) return { ok: false };
  // A channel with no renderer (mail, before F110 stage 20) never renders: the caller treats it as a bad view.
  const render = renderer[opts.channel]?.[opts.detail];
  if (render === undefined) return { ok: false };
  let message: OutMessage;
  try {
    message = render(parsed.data, opts);
  } catch {
    return { ok: false };
  }
  if (message.text.length < 1 || message.text.length > MESSAGE_MAX_CHARS) return { ok: false };
  if (!outButtonsSchema.safeParse(message.buttons).success) return { ok: false };
  return { ok: true, message };
}

export type NoticeEditInput = Parameters<typeof approvalEdit>[0];

export const noticeEditRenderers: {
  telegram: { full: (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage };
  mail?: { full: (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage };
  push?: { full: (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage };
} = {
  telegram: { full: (input, opts) => approvalEdit(input, textsFor(opts.locale)) },
};

// The edited message after a tap: the stored text of the card plus one status line. Throws like approvalEdit, and for a
// channel that has no cards (mail).
export function renderNoticeEdit(input: NoticeEditInput, opts: NoticeRenderOptions): OutMessage {
  const render = noticeEditRenderers[opts.channel]?.[opts.detail];
  if (render === undefined) throw new Error(`no card edit for channel ${opts.channel}`);
  return render(input, opts);
}
