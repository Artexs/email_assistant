import { wellFormedText } from "../digest/text";

import type { NoticeKind } from "./kinds";
import { type NoticeView, noticeViewSchemas } from "./views";

// The message holds the kind only: a view or a Zod error can hold mail text (ADR 0032 point 5).
export class NoticeViewError extends Error {
  constructor(readonly kind: NoticeKind) {
    super(`bad notice view for ${kind}`);
    this.name = "NoticeViewError";
  }
}

// The JSON that `outbox.view` stores: dates as ISO strings, no lone surrogate, no NUL (jsonb refuses both).
export function encodeNoticeView<K extends NoticeKind>(kind: K, view: NoticeView<K>): Record<string, unknown> {
  const json: unknown = JSON.parse(
    JSON.stringify(view, (_key, value: unknown) =>
      typeof value === "string" ? wellFormedText(value).replaceAll("\u0000", " ") : value
    )
  );
  if (!noticeViewSchemas[kind].safeParse(json).success) throw new NoticeViewError(kind);
  return json as Record<string, unknown>;
}
