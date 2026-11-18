import { describe, expect, test } from "bun:test";

import { encodeNoticeView, NoticeViewError } from "./encode";
import { noticeViewSchemas } from "./views";

// F115 stage 03: the views of the three reply notice kinds are strict (ADR 0032 point 5): a view holds exactly the facts
// that its renderer needs, and the reason is a code, never a text.
const now = "2026-11-20T10:05:00.000Z";
const emailId = "11111111-1111-4111-8111-111111111111";

describe("replies_ready view", () => {
  const view = { count: 3, now, timeZone: "Europe/Warsaw", review: true };

  test("accepts a count, the queue time, the time zone and the review flag; the panel link is optional", () => {
    expect(noticeViewSchemas.replies_ready.safeParse(view).success).toBe(true);
    expect(
      noticeViewSchemas.replies_ready.safeParse({ ...view, review: false, panelUrl: "https://app.test/approvals" })
        .success
    ).toBe(true);
    expect(noticeViewSchemas.replies_ready.safeParse({ ...view, panelUrl: "not a link" }).success).toBe(false);
  });

  test("refuses an extra key, a missing key and a count below 1", () => {
    expect(noticeViewSchemas.replies_ready.safeParse({ ...view, subject: "Re: contract" }).success).toBe(false);
    expect(noticeViewSchemas.replies_ready.safeParse({ ...view, emailId }).success).toBe(false);
    expect(noticeViewSchemas.replies_ready.safeParse({ count: 3, now }).success).toBe(false);
    expect(noticeViewSchemas.replies_ready.safeParse({ count: 3, now, timeZone: "Europe/Warsaw" }).success).toBe(false);
    expect(noticeViewSchemas.replies_ready.safeParse({ ...view, count: 0 }).success).toBe(false);
    expect(noticeViewSchemas.replies_ready.safeParse({ ...view, count: 1.5 }).success).toBe(false);
  });
});

describe("reply_prompt view", () => {
  test("accepts the mail id and nothing else", () => {
    expect(noticeViewSchemas.reply_prompt.safeParse({ emailId }).success).toBe(true);
  });

  test("is strict: an extra key (a subject, a body, a reason) is refused; the id is required", () => {
    expect(noticeViewSchemas.reply_prompt.safeParse({ emailId, subject: "Re: contract" }).success).toBe(false);
    expect(noticeViewSchemas.reply_prompt.safeParse({ emailId, reason: "answered" }).success).toBe(false);
    expect(noticeViewSchemas.reply_prompt.safeParse({}).success).toBe(false);
    expect(noticeViewSchemas.reply_prompt.safeParse({ emailId: "" }).success).toBe(false);
  });
});

describe("reply_result view", () => {
  test("accepts the mail id and a reason code", () => {
    for (const reason of ["answered", "llm_cap", "no_draft", "oauth_mailbox", "r".repeat(40)]) {
      expect(noticeViewSchemas.reply_result.safeParse({ emailId, reason }).success, reason).toBe(true);
    }
  });

  test("refuses an extra key", () => {
    expect(noticeViewSchemas.reply_result.safeParse({ emailId, reason: "answered", body: "Hello" }).success).toBe(
      false
    );
  });

  test("refuses a text as the reason: not a code, empty, too long, upper case, with an address", () => {
    for (const reason of [
      "The customer wants a quote",
      "needs facts",
      "Answered",
      "needs-facts",
      "",
      "r".repeat(41),
      "jan@firma.test",
      "żądanie",
    ]) {
      expect(noticeViewSchemas.reply_result.safeParse({ emailId, reason }).success, reason).toBe(false);
    }
    expect(noticeViewSchemas.reply_result.safeParse({ emailId }).success).toBe(false);
  });

  test("the encoder, which checks the view before it enters the outbox, refuses a text reason", () => {
    expect(() => encodeNoticeView("reply_result", { emailId, reason: "Needs facts about the offer" })).toThrow(
      NoticeViewError
    );
    expect(encodeNoticeView("reply_result", { emailId, reason: "needs_facts" })).toEqual({
      emailId,
      reason: "needs_facts",
    });
  });
});
