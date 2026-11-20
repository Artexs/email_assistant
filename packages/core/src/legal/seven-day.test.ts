import { describe, expect, test } from "bun:test";

import { sevenDayLimitProblems } from "./seven-day";

// The old wording at plan base 535e6f76 (`git show 535e6f76:docs/legal/claims.md` and `dpia.md`).
const OLD_C032 =
  "The assistant does not send mail older than 7 days, unless the operator loads old mail once (a backfill).";
const OLD_C201 = "Mail older than 7 days is not sent to the LLM, except a one-off backfill by the operator.";
const OLD_DPIA_R1 =
  "Only mail up to 7 days old (a one-off operator backfill is the exception) and a bounded context go to the LLM. The OpenAI adapter asks for no storage (`store: false`).";

describe("sevenDayLimitProblems", () => {
  test("returns the old wording of rows C032 and C201 and of the DPIA measure R1", () => {
    expect(sevenDayLimitProblems([OLD_C032, OLD_C201, OLD_DPIA_R1])).toEqual([OLD_C032, OLD_C201, OLD_DPIA_R1]);
  });

  test("returns a Polish text that names the limit alone", () => {
    const text = "Nie wysyła wiadomości starszych niż 7 dni.";
    expect(sevenDayLimitProblems([text])).toEqual([text]);
  });

  test("returns the wording '7-day limit' without the context", () => {
    const text = "The 7-day limit covers all mail that the AI gets.";
    expect(sevenDayLimitProblems([text])).toEqual([text]);
  });

  test("returns a text that names the context but not the classified mail", () => {
    const text =
      "It sends up to three earlier mails of the same thread as context. It does not send mail older than 7 days.";
    expect(sevenDayLimitProblems([text])).toEqual([text]);
  });

  test("passes a text that names the classified mail and the context", () => {
    expect(
      sevenDayLimitProblems([
        "It does not classify a mail older than 7 days; the context mails of its thread can be older.",
        "Nie klasyfikuje wiadomości starszej niż 7 dni; wiadomości kontekstowe mogą być starsze.",
      ])
    ).toEqual([]);
  });

  test("passes a text that does not name the limit and keeps the input order of the failures", () => {
    expect(sevenDayLimitProblems(["Copies are kept 30 days."])).toEqual([]);
    expect(sevenDayLimitProblems([OLD_C201, "fine", OLD_C032])).toEqual([OLD_C201, OLD_C032]);
  });
});
