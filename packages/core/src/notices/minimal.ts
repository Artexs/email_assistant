import { type DigestMinimalFacts, renderDigestMinimal } from "../digest/digest";
import { MESSAGE_MAX_CHARS, type OutMessage } from "../digest/message";
import { textsFor } from "../texts";
import { minimalTexts } from "../texts/minimal";

import { noticeFactsOf } from "./facts";
import type { NoticeKind, NoticeRenderOptions } from "./kinds";
import { noticePath } from "./push";
import type { NoticeView } from "./views";

// The `minimal` Telegram render (ADR 0032 point 5). The text holds fixed phrases, numbers, the clock and one panel link:
// no string of the view and no button. A change here is a privacy change: `registry-channels.test.ts` plants a canary in every string of
// every view and checks that none reaches the text.

/** The link of the panel to a path: the base without a trailing slash and the path. */
export function panelLinkOf(base: string | undefined, path: string): string | null {
  if (base === undefined || base === "") return null;
  return `${base.replace(/\/+$/, "")}${path}`;
}

// The last line of every minimal text: the link, or the plain "Open the panel" line when no base URL is set.
function linkLine(opts: NoticeRenderOptions, path: string): string {
  return panelLinkOf(opts.webBaseUrl, path) ?? minimalTexts(opts.locale).openPanel;
}

/**
 * The edit of a card at the `minimal` level: no button, and the panel link of the item when the stored text of the card has
 * none (a card that went out at `full` has no link, and the member can no longer reject it in the chat). `original` is the card's
 * own text, already in the chat; the link line is a fixed phrase of ours and holds no view string. Telegram refuses an edit over
 * `MESSAGE_MAX_CHARS`: a card that the link line would push over the limit keeps its text without the line.
 */
export function minimalEdit(
  edited: OutMessage,
  original: string,
  path: string | undefined,
  opts: Pick<NoticeRenderOptions, "locale" | "webBaseUrl">
): OutMessage {
  const plain = { ...edited, buttons: [] };
  if (path === undefined) return plain;
  const link = panelLinkOf(opts.webBaseUrl, path);
  const line = link ?? minimalTexts(opts.locale).openPanel;
  if (original.includes(line)) return plain;
  const text = `${edited.text}\n${line}`;
  return text.length > MESSAGE_MAX_CHARS ? plain : { ...plain, text };
}

/** The text that answers /review for a member with `minimal`: the review lives in the panel. */
export function minimalReviewMessage(opts: Pick<NoticeRenderOptions, "locale" | "webBaseUrl">): OutMessage {
  return { text: minimalTexts(opts.locale).reviewInPanel(panelLinkOf(opts.webBaseUrl, "/review")), buttons: [] };
}

type MinimalLineKind = Exclude<NoticeKind, "approval_edit" | "reply_prompt" | "loop_consent">;

/** One phrase with the count of the kind, then the link to the page of the kind. For every kind that has no text of its own. */
export function minimalOf<K extends MinimalLineKind>(
  kind: K
): { minimal: (view: NoticeView<K>, opts: NoticeRenderOptions) => OutMessage } {
  return {
    minimal: (view, opts) => {
      const { count, itemId } = noticeFactsOf(kind, view);
      return {
        text: [minimalTexts(opts.locale).line(kind, count), linkLine(opts, noticePath(kind, itemId))].join("\n"),
        buttons: [],
      };
    },
  };
}

/** The digest of a member with `minimal`, from its facts: the answer of /digest and the render of a digest row. */
export function minimalDigestMessage(facts: DigestMinimalFacts, opts: NoticeRenderOptions): OutMessage {
  return renderDigestMinimal(facts, textsFor(opts.locale), linkLine(opts, noticePath("digest", null)));
}

export function renderMinimalDigest(view: NoticeView<"digest">, opts: NoticeRenderOptions): OutMessage {
  if (view.minimal !== undefined) return minimalDigestMessage(view.minimal, opts);
  // A row queued before the facts existed: the fixed phrase and the link.
  const link = linkLine(opts, noticePath("digest", null));
  return { text: [minimalTexts(opts.locale).line("digest", 1), link].join("\n"), buttons: [] };
}

export function renderMinimalWeekly(view: NoticeView<"weekly_report">, opts: NoticeRenderOptions): OutMessage {
  const text = minimalTexts(opts.locale).weekly(view.week.m4.triaged, view.week.m4.handled);
  return { text: [text, linkLine(opts, noticePath("weekly_report", null))].join("\n"), buttons: [] };
}

// `about` is one of two codes that pick a fixed line of ours; the panel URL of the view is not printed.
export function renderMinimalLoopConsent(view: NoticeView<"loop_consent">, opts: NoticeRenderOptions): OutMessage {
  const text = textsFor(opts.locale).notices.loopConsent[view.about];
  return { text: [text, linkLine(opts, noticePath("loop_consent", null))].join("\n"), buttons: [] };
}
