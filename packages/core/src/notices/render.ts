import type { z } from "zod";

import { approvalEdit } from "../digest/approvals";
import { MESSAGE_MAX_CHARS, type OutMessage, outButtonsSchema } from "../digest/message";

import type { NoticeKind, NoticeRenderOptions } from "./kinds";
import { type NoticeRenderer, noticeRenderers } from "./renderers";

export type NoticeRenderResult = { ok: true; message: OutMessage } | { ok: false };

// Never throws: a view its schema rejects, a renderer that throws, an empty or too long text, bad buttons → { ok: false }.
// `text.length` counts UTF-16 units, so it is never below Postgres `char_length`: the DB CHECK cannot fail after this check.
export function renderNotice(kind: NoticeKind, view: unknown, opts: NoticeRenderOptions): NoticeRenderResult {
  const renderer: NoticeRenderer<z.ZodType> = noticeRenderers[kind];
  const parsed = renderer.schema.safeParse(view);
  if (!parsed.success) return { ok: false };
  let message: OutMessage;
  try {
    message = renderer[opts.channel][opts.detail](parsed.data, opts);
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
} = {
  telegram: { full: (input) => approvalEdit(input) },
};

// The edited message after a tap: the stored text of the card plus one status line. Throws like approvalEdit.
export function renderNoticeEdit(input: NoticeEditInput, opts: NoticeRenderOptions): OutMessage {
  return noticeEditRenderers[opts.channel][opts.detail](input, opts);
}
