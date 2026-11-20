import { describe, expect, test } from "bun:test";

import { DAY_MS } from "../time";

import {
  isAutoSubmitted,
  REPLY_AUTO_MAX_AGE_MS,
  REPLY_BLOCK_REASONS,
  type ReplyBlockReason,
  type ReplyFacts,
  replyEligibility,
  type ReplyTrigger,
} from "./index";

const NOW = new Date("2026-11-17T12:00:00Z");

const clean: ReplyFacts = {
  triaged: true,
  category: "needs_reply",
  language: "pl",
  fromJunk: false,
  fromAddress: "anna@client.test",
  ownAddresses: ["boss@firm.test", "Sales@Firm.test"],
  headers: { listId: null, listUnsubscribe: null, autoSubmitted: null, precedence: null, hasCalendar: false },
  suspicion: { state: "clean" },
  answered: false,
  receivedAt: new Date(NOW.getTime() - 2 * DAY_MS),
  ownerLocale: null,
};

const headers = (change: Partial<NonNullable<ReplyFacts["headers"]>>): ReplyFacts["headers"] => ({
  ...(clean.headers as NonNullable<ReplyFacts["headers"]>),
  ...change,
});

function run(change: Partial<ReplyFacts>, trigger: ReplyTrigger = "auto") {
  return replyEligibility({ ...clean, ...change }, { trigger, now: NOW });
}

const block = (reason: ReplyBlockReason) => ({ ok: false as const, reason });

describe("replyEligibility", () => {
  test("1: a clean person mail, needs_reply, pl, 2 days old is ok in pl", () => {
    expect(run({})).toEqual({ ok: true, language: "pl" });
    expect(run({ language: "en" })).toEqual({ ok: true, language: "en" });
  });

  test("2: untriaged mail and mail with no headers are not checked, also on a tap", () => {
    for (const trigger of ["auto", "tap", "redraft", "sample"] as const) {
      expect(run({ suspicion: { state: "untriaged" } }, trigger)).toEqual(block("not_checked"));
      expect(run({ headers: null }, trigger)).toEqual(block("not_checked"));
      expect(run({ triaged: false, category: null }, trigger)).toEqual(block("not_checked"));
    }
  });

  test("3: a flagged mail is suspicious for every trigger", () => {
    for (const trigger of ["auto", "tap", "redraft", "sample"] as const) {
      expect(run({ suspicion: { state: "flagged", reasons: ["reply_to_mismatch"] } }, trigger)).toEqual(
        block("suspicious")
      );
    }
  });

  test("4: list headers, automatic mail, bulk precedence and no-reply senders are not a person", () => {
    expect(run({ headers: headers({ listId: "news.x" }) })).toEqual(block("not_a_person"));
    expect(run({ headers: headers({ listUnsubscribe: "<mailto:u@x.test>" }) })).toEqual(block("not_a_person"));
    expect(run({ headers: headers({ autoSubmitted: "no" }) })).toEqual({ ok: true, language: "pl" });
    expect(run({ headers: headers({ autoSubmitted: "auto-replied" }) })).toEqual(block("not_a_person"));
    expect(run({ headers: headers({ autoSubmitted: "auto-generated; x=y" }) })).toEqual(block("not_a_person"));
    expect(run({ headers: headers({ precedence: "bulk" }) })).toEqual(block("not_a_person"));
    expect(run({ headers: headers({ precedence: " List " }) })).toEqual(block("not_a_person"));
    expect(run({ headers: headers({ precedence: "junk" }) })).toEqual(block("not_a_person"));
    expect(run({ headers: headers({ precedence: "first-class" }) })).toEqual({ ok: true, language: "pl" });
    expect(run({ fromAddress: "no-reply@client.test" })).toEqual(block("not_a_person"));
    expect(run({ fromAddress: null })).toEqual(block("not_a_person"));
    for (const trigger of ["tap", "redraft", "sample"] as const) {
      expect(run({ headers: headers({ listId: "news.x" }) }, trigger)).toEqual(block("not_a_person"));
    }
  });

  test("4b: a blank header value is not set; Auto-Submitted keeps the keyword before the first semicolon", () => {
    expect(isAutoSubmitted(null)).toBe(false);
    expect(isAutoSubmitted("  ")).toBe(false);
    expect(isAutoSubmitted(" No ")).toBe(false);
    expect(isAutoSubmitted("no; x=y")).toBe(false);
    expect(isAutoSubmitted("auto-notified")).toBe(true);
    expect(run({ headers: headers({ listId: "  " }) })).toEqual({ ok: true, language: "pl" });
  });

  test("5: a sender that is an own mailbox of the organization is own_mailbox, in any case", () => {
    expect(run({ fromAddress: "boss@firm.test" })).toEqual(block("own_mailbox"));
    expect(run({ fromAddress: "SALES@firm.test" })).toEqual(block("own_mailbox"));
    expect(run({ fromAddress: "boss@firm.test" }, "tap")).toEqual(block("own_mailbox"));
  });

  test("6: a calendar mail is calendar; an answered mail is answered, also on a tap", () => {
    expect(run({ headers: headers({ hasCalendar: true }) })).toEqual(block("calendar"));
    expect(run({ headers: headers({ hasCalendar: true }) }, "tap")).toEqual(block("calendar"));
    expect(run({ answered: true })).toEqual(block("answered"));
    expect(run({ answered: true }, "tap")).toEqual(block("answered"));
    expect(run({ answered: true }, "redraft")).toEqual(block("answered"));
  });

  test("7: auto needs the category needs_reply; a tap does not", () => {
    expect(run({ category: "info" })).toEqual(block("category"));
    expect(run({ category: "urgent" })).toEqual(block("category"));
    expect(run({ category: "info" }, "tap")).toEqual({ ok: true, language: "pl" });
    expect(run({ category: "spam" }, "sample")).toEqual({ ok: true, language: "pl" });
  });

  test("8: auto needs mail of at most 7 days; a tap does not", () => {
    expect(run({ receivedAt: new Date(NOW.getTime() - 8 * DAY_MS) })).toEqual(block("too_old"));
    expect(run({ receivedAt: new Date(NOW.getTime() - REPLY_AUTO_MAX_AGE_MS - 1) })).toEqual(block("too_old"));
    expect(run({ receivedAt: new Date(NOW.getTime() - REPLY_AUTO_MAX_AGE_MS) })).toEqual({ ok: true, language: "pl" });
    expect(run({ receivedAt: new Date(NOW.getTime() - 8 * DAY_MS) }, "tap")).toEqual({ ok: true, language: "pl" });
  });

  test("9: auto refuses the language other; a tap drafts in the language of the owner (null reads as pl)", () => {
    expect(run({ language: "other" })).toEqual(block("language"));
    expect(run({ language: "other", ownerLocale: "en" })).toEqual(block("language"));
    expect(run({ language: "other", ownerLocale: "en" }, "tap")).toEqual({ ok: true, language: "en" });
    expect(run({ language: "other", ownerLocale: "pl" }, "redraft")).toEqual({ ok: true, language: "pl" });
    expect(run({ language: "other", ownerLocale: null }, "sample")).toEqual({ ok: true, language: "pl" });
    expect(run({ language: "en", ownerLocale: "pl" }, "tap")).toEqual({ ok: true, language: "en" });
  });

  test("the first failure is the reason: the order of the checks", () => {
    const all: Partial<ReplyFacts> = {
      triaged: false,
      suspicion: { state: "untriaged" },
      headers: null,
      fromJunk: true,
      fromAddress: "boss@firm.test",
      answered: true,
      category: "info",
      language: "other",
      receivedAt: new Date(NOW.getTime() - 9 * DAY_MS),
    };
    expect(run(all)).toEqual(block("not_checked"));
    const triagedFlagged = {
      ...all,
      triaged: true,
      headers: clean.headers,
      suspicion: { state: "flagged" as const, reasons: ["auth_fail" as const] },
    };
    expect(run(triagedFlagged)).toEqual(block("suspicious"));
    const junk = { ...triagedFlagged, suspicion: { state: "clean" as const } };
    expect(run(junk)).toEqual(block("junk_source"));
    const own = { ...junk, fromJunk: false };
    expect(run(own)).toEqual(block("own_mailbox"));
    const person = { ...own, fromAddress: "no-reply@client.test", headers: headers({ hasCalendar: true }) };
    expect(run(person)).toEqual(block("not_a_person"));
    const calendar = { ...person, fromAddress: "anna@client.test" };
    expect(run(calendar)).toEqual(block("calendar"));
    const answered = { ...calendar, headers: clean.headers };
    expect(run(answered)).toEqual(block("answered"));
    const category = { ...answered, answered: false };
    expect(run(category)).toEqual(block("category"));
    const old = { ...category, category: "needs_reply" as const };
    expect(run(old)).toEqual(block("too_old"));
    const language = { ...old, receivedAt: clean.receivedAt };
    expect(run(language)).toEqual(block("language"));
  });

  test("a junk mail is junk_source for every trigger", () => {
    for (const trigger of ["auto", "tap", "redraft", "sample"] as const) {
      expect(run({ fromJunk: true }, trigger)).toEqual(block("junk_source"));
    }
  });

  test("open_newer and oauth_mailbox are reasons of the callers; the rule never returns them", () => {
    expect(REPLY_BLOCK_REASONS).toContain("open_newer");
    expect(REPLY_BLOCK_REASONS).toContain("oauth_mailbox");
    const seen = new Set<string>();
    for (const change of [
      { triaged: false },
      { suspicion: { state: "flagged" as const, reasons: ["auth_fail" as const] } },
      { fromJunk: true },
      { fromAddress: "boss@firm.test" },
      { fromAddress: "no-reply@client.test" },
      { headers: headers({ hasCalendar: true }) },
      { answered: true },
      { category: "info" as const },
      { receivedAt: new Date(NOW.getTime() - 9 * DAY_MS) },
      { language: "other" as const },
    ]) {
      const result = run(change);
      if (!result.ok) seen.add(result.reason);
    }
    expect([...seen].sort()).toEqual(
      REPLY_BLOCK_REASONS.filter((reason) => reason !== "open_newer" && reason !== "oauth_mailbox").sort()
    );
  });
});
