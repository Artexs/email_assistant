import type { z } from "zod";

import { approvalEdit } from "../digest/approvals";
import { MESSAGE_MAX_CHARS, type OutMessage, outButtonsSchema } from "../digest/message";
import { textsFor } from "../texts";

import { minimalEdit } from "./minimal";
import type { NoticeDetail, NoticeKind, NoticeRenderOptions } from "./kinds";
import { type NoticeRenderer, noticeRenderers } from "./renderers";

export type NoticeRenderResult = { ok: true; message: OutMessage } | { ok: false };

// Never throws: a view its schema rejects, a renderer that throws, an empty or too long text, bad buttons → { ok: false }.
// `text.length` counts UTF-16 units, so it is never below Postgres `char_length`: the DB CHECK cannot fail after this check.
export function renderNotice(kind: NoticeKind, view: unknown, opts: NoticeRenderOptions): NoticeRenderResult {
  const renderer: NoticeRenderer<z.ZodType> = noticeRenderers[kind];
  const parsed = renderer.schema.safeParse(view);
  if (!parsed.success) return { ok: false };
  // A channel with no renderer (mail, before its renderer existed) never renders: the caller treats it as a bad view.
  // Only Telegram has a `minimal` render: a mail or push row with that detail never renders.
  const byDetail: Partial<Record<NoticeDetail, (view: unknown, opts: NoticeRenderOptions) => OutMessage>> | undefined =
    renderer[opts.channel];
  const render = byDetail?.[opts.detail];
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

// `panelPath`: the panel path of the card's item (`noticePath`). Only the `minimal` edit reads it: it adds the link when the card has none.
export type NoticeEditInput = Parameters<typeof approvalEdit>[0] & { panelPath?: string };

export const noticeEditRenderers: {
  telegram: {
    full: (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage;
    minimal: (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage;
  };
  mail?: { full: (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage };
  push?: { full: (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage };
} = {
  // The edit holds the stored text of a card that is already in the chat plus one status line. `minimal` has no button.
  telegram: {
    full: (input, opts) => approvalEdit(input, textsFor(opts.locale)),
    minimal: (input, opts) =>
      minimalEdit(approvalEdit(input, textsFor(opts.locale)), input.original, input.panelPath, opts),
  },
};

// The edited message after a tap: the stored text of the card plus one status line. Throws like approvalEdit, and for a
// channel that has no cards (mail).
export function renderNoticeEdit(input: NoticeEditInput, opts: NoticeRenderOptions): OutMessage {
  const byDetail:
    | Partial<Record<NoticeDetail, (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage>>
    | undefined = noticeEditRenderers[opts.channel];
  const render = byDetail?.[opts.detail];
  if (render === undefined) throw new Error(`no card edit for channel ${opts.channel}`);
  return render(input, opts);
}
