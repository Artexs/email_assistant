/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";

import { setLocaleForTest, t, tp, type TextKey } from "../i18n";
import { en } from "../i18n/en";

import { createApi } from "./api";
import {
  suggestButton,
  suggestFailureKey,
  suggestStyle,
  type SuggestAnswer,
  type SuggestButton,
  type SuggestGate,
} from "./style-suggest";

afterEach(() => setLocaleForTest("en"));

const MAILBOX = "0190f5a0-0000-7000-8000-000000000003";

const gate = (over: Partial<SuggestGate> = {}): SuggestGate => ({
  isOwner: true,
  replyDraftsOn: true,
  styleFromSentOn: true,
  sentTracking: "on",
  oauth: false,
  ...over,
});

describe("the state of the suggest button", () => {
  const rows: [string, Partial<SuggestGate>, SuggestButton][] = [
    ["an owner with both flags and sent tracking on: active", {}, { kind: "active" }],
    ["sent tracking off: off, with the line", { sentTracking: "off" }, { kind: "off", key: "rs_suggest_sent_off" }],
    [
      "the sent mail flag off: off, with the same line",
      { sentTracking: "flag_off" },
      { kind: "off", key: "rs_suggest_sent_off" },
    ],
    [
      "an OAuth mailbox: the reason line of the reply drafts switch",
      { oauth: true },
      { kind: "off", key: "rs_switch_oauth" },
    ],
    ["a member: hidden", { isOwner: false }, { kind: "hidden" }],
    ["a member with sent tracking off: still hidden", { isOwner: false, sentTracking: "off" }, { kind: "hidden" }],
    ["reply drafts off: hidden", { replyDraftsOn: false }, { kind: "hidden" }],
    ["the style flag off: hidden", { styleFromSentOn: false }, { kind: "hidden" }],
  ];
  test.each(rows)("%s", (_name, over, expected) => {
    expect(suggestButton(gate(over))).toEqual(expected);
  });
});

// The answers of the route, through the real client with a fake transport.
function answerFor(status: number, body: unknown): Promise<SuggestAnswer> {
  const calls: { path: string; init?: RequestInit }[] = [];
  const request = createApi({
    fetchImpl: (path, init) => {
      calls.push({ path, init });
      return Promise.resolve(Response.json(body, { status }));
    },
    onUnauthorized: () => undefined,
  });
  return suggestStyle(MAILBOX, request).finally(() => {
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(`/api/mailboxes/${MAILBOX}/profile/style-suggestion`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe("{}");
  });
}

describe("the answer of the style suggestion route", () => {
  const rows: [string, number, unknown, SuggestAnswer][] = [
    ["200 text", 200, { text: "Krótko.", count: 7 }, { kind: "suggestion", text: "Krótko.", count: 7 }],
    ["200 failed llm_off", 200, { kind: "failed", reason: "llm_off" }, { kind: "note", key: "rs_preview_llm_off" }],
    ["200 failed llm_cap", 200, { kind: "failed", reason: "llm_cap" }, { kind: "note", key: "rs_preview_cap" }],
    ["200 failed checks", 200, { kind: "failed", reason: "checks" }, { kind: "note", key: "rs_suggest_failed" }],
    ["200 failed output", 200, { kind: "failed", reason: "output" }, { kind: "note", key: "rs_suggest_failed" }],
    ["200 failed provider", 200, { kind: "failed", reason: "provider" }, { kind: "note", key: "rs_suggest_failed" }],
    ["409 sent_off", 409, { error: "sent_off" }, { kind: "note", key: "rs_suggest_sent_off" }],
    ["409 too_few", 409, { error: "too_few", count: 3 }, { kind: "note", key: "rs_suggest_too_few", count: 3 }],
    ["409 blocked", 409, { error: "blocked", reason: "oauth_mailbox" }, { kind: "note", key: "rs_switch_oauth" }],
    ["429 suggest_limit", 429, { error: "suggest_limit" }, { kind: "note", key: "rs_suggest_limit" }],
    ["429 suggest_busy", 429, { error: "suggest_busy" }, { kind: "note", key: "rs_suggest_busy" }],
  ];
  test.each(rows)("%s", async (_name, status, body, expected) => {
    expect(await answerFor(status, body)).toEqual(expected);
  });

  test("an error that is not an answer is thrown: a 500, an unknown 409, a 429 of another kind", async () => {
    for (const [status, body] of [
      [500, { error: "internal" }],
      [409, { error: "something_else" }],
      [429, { error: "rate_limited" }],
    ] as const) {
      await expect(answerFor(status, body)).rejects.toMatchObject({ status });
    }
  });

  test("a failure reason that the server adds later gets the general text", () => {
    expect(suggestFailureKey("new_reason")).toBe("rs_suggest_failed");
  });

  test("the English texts are the ones of the card", () => {
    const fixed: Partial<Record<TextKey, string>> = {
      rs_suggest_button: "Suggest my style from my sent mail",
      rs_suggest_note:
        "Sends up to 100 sent mails of this mailbox from the last 14 days to the AI provider, in at most two calls. Only the text you save is kept.",
      rs_suggest_use: "Use this text",
      rs_suggest_discard: "Discard",
      rs_suggest_too_few: "Not enough sent mail yet ({count} of 5). Try again after you send more mail.",
      rs_suggest_sent_off: "Turn on 'Track my sent mail' to use this.",
      rs_suggest_limit: "You can ask for 3 suggestions a day. Try again later.",
      rs_suggest_busy: "A suggestion is being written. Wait a moment.",
      rs_suggest_failed: "No suggestion this time. Try again later.",
    };
    for (const [key, text] of Object.entries(fixed)) expect([key, en[key as TextKey]]).toEqual([key, text]);
    expect(t("rs_suggest_too_few", { count: 3 })).toBe(
      "Not enough sent mail yet (3 of 5). Try again after you send more mail."
    );
    expect([tp("rs_suggest_result", 1), tp("rs_suggest_result", 7)]).toEqual([
      "Based on 1 sent mail",
      "Based on 7 sent mails",
    ]);
  });

  test("the Polish result head takes the plural form of its count", () => {
    setLocaleForTest("pl");
    expect([1, 2, 5, 22, 12].map((count) => tp("rs_suggest_result", count))).toEqual([
      "Na podstawie 1 wysłanej wiadomości",
      "Na podstawie 2 wysłanych wiadomości",
      "Na podstawie 5 wysłanych wiadomości",
      "Na podstawie 22 wysłanych wiadomości",
      "Na podstawie 12 wysłanych wiadomości",
    ]);
    expect(t("rs_suggest_too_few", { count: 3 })).toBe(
      "Na razie za mało wysłanych wiadomości (3 z 5). Spróbuj ponownie po wysłaniu kolejnych."
    );
  });
});
