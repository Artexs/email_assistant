import { describe, expect, test } from "bun:test";

import { isAutoReply, normalizeSubject, replyMatch, type ReplyLoop, type ReplyMail } from "./replies";

const DAY = 86_400_000;
const WAIT_FROM = new Date("2026-11-10T10:00:00Z");
const after = (days: number) => new Date(WAIT_FROM.getTime() + days * DAY);
const own = ["me@own.test"];

const loop = (over: Partial<ReplyLoop> = {}): ReplyLoop => ({
  threadKey: "<root@own.test>",
  messageId: "<last@own.test>",
  toAddresses: ["anna@example.test"],
  ccAddresses: ["jan@example.test"],
  subject: "Oferta Q1",
  waitFromAt: WAIT_FROM,
  ...over,
});

const mail = (over: Partial<ReplyMail> = {}): ReplyMail => ({
  threadKey: "<other@x.test>",
  receivedAt: after(3),
  fromAddress: "anna@example.test",
  subject: "Re: Oferta Q1",
  inReplyTo: null,
  referencesHeader: null,
  autoSubmitted: null,
  precedence: null,
  ...over,
});

const match = (m: Partial<ReplyMail>, l: Partial<ReplyLoop> = {}) =>
  replyMatch(loop(l), mail(m), { ownAddresses: own });

describe("normalizeSubject (T1)", () => {
  test("drops repeated prefixes, collapses spaces, lower case", () => {
    expect(normalizeSubject("RE: Odp: Fwd:  Oferta  Q1")).toBe("oferta q1");
    expect(normalizeSubject("PD: fw: ODP: Oferta")).toBe("oferta");
    expect(normalizeSubject("  re :  RE  :Oferta Q1 ")).toBe("oferta q1");
    expect(normalizeSubject("Re:Re:Re:Oferta")).toBe("oferta");
  });

  test("keeps a prefix that is part of a word or in the middle", () => {
    expect(normalizeSubject("Report: Q1")).toBe("report: q1");
    expect(normalizeSubject("Oferta Re: Q1")).toBe("oferta re: q1");
    expect(normalizeSubject("Pdf: plik")).toBe("pdf: plik");
    expect(normalizeSubject("Re Oferta")).toBe("re oferta");
  });

  test("an empty result stays empty", () => {
    expect(normalizeSubject("Re: Fwd: ")).toBe("");
    expect(normalizeSubject("   ")).toBe("");
    expect(normalizeSubject(null)).toBe("");
    expect(normalizeSubject(undefined)).toBe("");
  });

  test("encoded forms: a full-width colon, a no-break space, zero-width and control characters", () => {
    expect(normalizeSubject("Re：Oferta Q1")).toBe("oferta q1");
    expect(normalizeSubject("Re: Oferta  Q1")).toBe("oferta q1");
    expect(normalizeSubject("R​e:​ Oferta Q1")).toBe("oferta q1");
    expect(normalizeSubject("Re:\tOferta\r\nQ1")).toBe("oferta q1");
    expect(normalizeSubject("﻿RE: Oferta Q1")).toBe("oferta q1");
  });

  test("a look-alike prefix (Cyrillic letter) is not stripped", () => {
    expect(normalizeSubject("Rе: Oferta Q1")).not.toBe("oferta q1");
  });

  test("a subject with a very long run of prefixes or spaces is bounded", () => {
    const started = performance.now();
    normalizeSubject(`${"Re: ".repeat(50_000)}x`);
    normalizeSubject(`Re:${" ".repeat(100_000)}x`);
    normalizeSubject(`${"Re:".repeat(100_000)}`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("isAutoReply (T4, T5)", () => {
  const base = { autoSubmitted: null, precedence: null, fromAddress: "anna@example.test" };

  test("Auto-Submitted: anything but no", () => {
    expect(isAutoReply({ ...base, autoSubmitted: "auto-replied" })).toBe(true);
    expect(isAutoReply({ ...base, autoSubmitted: "AUTO-GENERATED" })).toBe(true);
    expect(isAutoReply({ ...base, autoSubmitted: "auto-replied; owner=x" })).toBe(true);
    expect(isAutoReply({ ...base, autoSubmitted: "no" })).toBe(false);
    expect(isAutoReply({ ...base, autoSubmitted: " No " })).toBe(false);
    expect(isAutoReply({ ...base, autoSubmitted: "" })).toBe(false);
    expect(isAutoReply({ ...base, autoSubmitted: null })).toBe(false);
    // A look-alike of the value `no` is not `no`.
    expect(isAutoReply({ ...base, autoSubmitted: "nope" })).toBe(true);
  });

  test("Precedence bulk, junk, list, auto_reply", () => {
    for (const value of ["bulk", "Junk", " list ", "auto_reply"]) {
      expect(isAutoReply({ ...base, precedence: value })).toBe(true);
    }
    expect(isAutoReply({ ...base, precedence: "first-class" })).toBe(false);
  });

  test("system senders, in several forms", () => {
    for (const from of [
      "mailer-daemon@example.test",
      "MAILER-DAEMON@Example.test",
      "postmaster@example.test",
      "no-reply@example.test",
      "noreply@example.test",
      "no_reply@example.test",
      "do.not.reply@example.test",
      "mailer-daemon+bounce@example.test",
    ]) {
      expect(isAutoReply({ ...base, fromAddress: from })).toBe(true);
    }
    // The local part is compared whole: a person named like a prefix is a person.
    for (const from of ["postmaster-anna@example.test", "anna@mailer-daemon.test", "noreplyanna@example.test"]) {
      expect(isAutoReply({ ...base, fromAddress: from })).toBe(false);
    }
    expect(isAutoReply({ ...base, fromAddress: null })).toBe(false);
  });
});

describe("replyMatch", () => {
  test("T2 subject: a recipient, other thread, same normalized subject, 3 days after", () => {
    expect(match({})).toBe("subject");
    expect(match({ receivedAt: after(30) })).toBe("subject");
    expect(match({ receivedAt: after(31) })).toBeNull();
    expect(match({ receivedAt: new Date(after(30).getTime() + 1) })).toBeNull();
  });

  test("subject: a Cc recipient and an upper-case address count", () => {
    expect(match({ fromAddress: "Jan@Example.TEST" })).toBe("subject");
  });

  test("T3 subject: a sender who is not a recipient does not match", () => {
    expect(match({ fromAddress: "obcy@example.test" })).toBeNull();
    // Look-alike addresses: a suffix, a prefix, a plus tag, a display name.
    for (const from of [
      "anna@example.test.evil.test",
      "xanna@example.test",
      "anna+x@example.test",
      "Anna <anna@example.test>",
    ]) {
      expect(match({ fromAddress: from })).toBeNull();
    }
  });

  test("subject: another subject, an empty subject, a loop without a subject", () => {
    expect(match({ subject: "Re: Inna sprawa" })).toBeNull();
    expect(match({ subject: "Re:" }, { subject: "Re:" })).toBeNull();
    expect(match({ subject: null }, { subject: null })).toBeNull();
    expect(match({}, { subject: null })).toBeNull();
    expect(match({ subject: "RE：Oferta Q1" })).toBe("subject");
    expect(match({ subject: "Rе: Oferta Q1" })).toBeNull();
  });

  test("a mail counts only after wait_from_at", () => {
    expect(match({ receivedAt: WAIT_FROM })).toBeNull();
    expect(match({ receivedAt: new Date(WAIT_FROM.getTime() - 1) })).toBeNull();
    expect(match({ receivedAt: new Date(WAIT_FROM.getTime() + 1) })).toBe("subject");
    expect(match({ threadKey: "<root@own.test>", receivedAt: WAIT_FROM })).toBeNull();
  });

  test("T6 an own address never counts", () => {
    expect(match({ fromAddress: "me@own.test", threadKey: "<root@own.test>" })).toBeNull();
    expect(match({ fromAddress: "ME@Own.test", threadKey: "<root@own.test>" })).toBeNull();
    expect(match({ fromAddress: null, threadKey: "<root@own.test>" })).toBeNull();
    expect(match({ fromAddress: "", threadKey: "<root@own.test>" })).toBeNull();
  });

  test("thread: the thread key, from any sender, without a time limit", () => {
    expect(match({ threadKey: "<root@own.test>", fromAddress: "obcy@example.test", subject: "x" })).toBe("thread");
    expect(match({ threadKey: "<root@own.test>", receivedAt: after(90) })).toBe("thread");
    expect(match({ threadKey: "<root@own.test>x" })).toBe("subject");
  });

  test("thread: In-Reply-To or References hold the message id of the loop", () => {
    const other = { subject: "x", fromAddress: "obcy@example.test" };
    expect(match({ ...other, inReplyTo: "<last@own.test>" })).toBe("thread");
    expect(match({ ...other, referencesHeader: "<a@x.test> <last@own.test>" })).toBe("thread");
    expect(match({ ...other, inReplyTo: "<last@own.test> (Anna's mail)" })).toBe("thread");
    expect(match({ ...other, inReplyTo: "last@own.test" })).toBe("thread");
    expect(match({ ...other, referencesHeader: "<a@x.test>\r\n\t<last@own.test>" })).toBe("thread");
  });

  test("thread: look-alike ids do not match", () => {
    const other = { subject: "x", fromAddress: "obcy@example.test" };
    for (const value of [
      "<last@own.test.evil.test>",
      "<xlast@own.test>",
      "<LAST@own.test>",
      "<last@own.test",
      "last@own.test.evil.test",
      "<a@x.test> last@own.test@y",
      "",
    ]) {
      expect(match({ ...other, inReplyTo: value, referencesHeader: value })).toBeNull();
    }
    expect(match({ ...other, inReplyTo: "<last@own.test>" }, { messageId: null })).toBeNull();
    expect(match({ ...other, inReplyTo: "<last@own.test>" }, { messageId: "" })).toBeNull();
    // The loop id may be stored with or without brackets.
    expect(match({ ...other, inReplyTo: "<last@own.test>" }, { messageId: "last@own.test" })).toBe("thread");
  });

  test("T4 auto: an automatic mail that would match by thread or by subject", () => {
    expect(match({ threadKey: "<root@own.test>", autoSubmitted: "auto-replied" })).toBe("auto");
    expect(match({ threadKey: "<root@own.test>", autoSubmitted: "no" })).toBe("thread");
    expect(match({ autoSubmitted: "auto-replied" })).toBe("auto");
    expect(match({ precedence: "bulk" })).toBe("auto");
  });

  test("T5 auto: a mailer-daemon in the thread", () => {
    expect(match({ fromAddress: "mailer-daemon@example.test", threadKey: "<root@own.test>" })).toBe("auto");
  });

  test("auto: a mail that matches neither is null, not auto", () => {
    expect(match({ autoSubmitted: "auto-replied", subject: "Inna sprawa" })).toBeNull();
    expect(match({ autoSubmitted: "auto-replied", receivedAt: after(31) })).toBeNull();
  });
});

// The probes of the stage: quoted, encoded and look-alike forms of every value the rules read. A form that the rules do not
// read as the plain value must not match (a missed close is a late follow-up; a false close hides a slip).
describe("replyMatch probes: quoted, encoded and look-alike forms", () => {
  const other = { subject: "x", fromAddress: "obcy@example.test" };

  test("a sender address in a quoted, display-name or percent-encoded form is not a recipient", () => {
    for (const from of [
      '"anna@example.test"',
      "'anna@example.test'",
      '"Anna" <anna@example.test>',
      "anna%40example.test",
      "anna&#64;example.test",
      "anna@EXAMPLE.test.",
      "anna@example.test\u200b",
      "аnna@example.test",
      "anna@exаmple.test",
    ]) {
      expect(match({ fromAddress: from })).toBeNull();
    }
  });

  test("a subject in a quoted or encoded-word form does not match; a full-width form of the plain subject does", () => {
    for (const subject of [
      '"Re: Oferta Q1"',
      "=?UTF-8?Q?Re=3A_Oferta_Q1?=",
      "=?UTF-8?B?UmU6IE9mZXJ0YSBRMQ==?=",
      "Re%3A Oferta Q1",
      "Re&#58; Oferta Q1",
      "Oferta Q1 (Re:)",
    ]) {
      expect(match({ subject })).toBeNull();
    }
    expect(match({ subject: "Ｒｅ： Ｏｆｅｒｔａ　Ｑ１" })).toBe("subject");
  });

  test("a message id in a percent-encoded, entity or look-alike form does not match; a quoted plain id does", () => {
    for (const value of [
      "%3Clast@own.test%3E",
      "&lt;last@own.test&gt;",
      "<last@own.test\u200b>",
      "<lаst@own.test>",
      "<last@own.test/>",
      "<last@own%2Etest>",
    ]) {
      expect(match({ ...other, inReplyTo: value, referencesHeader: value })).toBeNull();
    }
    expect(match({ ...other, inReplyTo: '"<last@own.test>"' })).toBe("thread");
  });

  test("an Auto-Submitted or Precedence value in a quoted or encoded form is read as written", () => {
    expect(isAutoReply({ autoSubmitted: '"no"', precedence: null, fromAddress: null })).toBe(true);
    expect(isAutoReply({ autoSubmitted: "n\u200bo", precedence: null, fromAddress: null })).toBe(true);
    expect(isAutoReply({ autoSubmitted: null, precedence: '"bulk"', fromAddress: null })).toBe(false);
    expect(isAutoReply({ autoSubmitted: "no", precedence: "bulk", fromAddress: null })).toBe(true);
  });

  test("a thread key with a different case or a trailing space is another thread", () => {
    expect(match({ ...other, threadKey: "<ROOT@own.test>" })).toBeNull();
    expect(match({ ...other, threadKey: "<root@own.test> " })).toBeNull();
  });
});

describe("subject prefixes of other mail programs and out-of-office subjects", () => {
  test("AW, SV, WG, TR, Antw, a count, a gateway tag and a closing dot are not part of the subject", () => {
    for (const subject of [
      "AW: Oferta Q1",
      "SV: Oferta Q1",
      "WG: Oferta Q1",
      "TR: Oferta Q1",
      "Antw: Oferta Q1",
      "Re[2]: Oferta Q1",
      "Re(3): Oferta Q1",
      "[EXT] Re: Oferta Q1",
      "Re: [EXT] Oferta Q1",
      "[External] Oferta Q1",
      "Re: Oferta Q1.",
      "Re: Oferta Q1 ..",
    ]) {
      expect(normalizeSubject(subject)).toBe("oferta q1");
      expect(match({ subject })).toBe("subject");
    }
  });

  test("a word that only starts like a prefix stays", () => {
    expect(normalizeSubject("Award: Q1")).toBe("award: q1");
    expect(normalizeSubject("Transfer: Q1")).toBe("transfer: q1");
    expect(normalizeSubject("[EXTRA] Q1")).toBe("[extra] q1");
    expect(normalizeSubject("[EXT]")).toBe("");
    expect(normalizeSubject("Re[x]: Q1")).toBe("re[x]: q1");
  });

  test("an out-of-office subject is automatic, with or without reply prefixes, in English and Polish", () => {
    for (const subject of [
      "Automatic reply: Oferta Q1",
      "Autoreply: Oferta Q1",
      "Auto-Reply: Oferta Q1",
      "Out of Office: Oferta Q1",
      "Re: Out of office : Oferta Q1",
      "Odpowiedź automatyczna: Oferta Q1",
      "Odpowiedz automatyczna: Oferta Q1",
      "Nieobecność: Oferta Q1",
    ]) {
      expect(isAutoReply({ autoSubmitted: null, precedence: null, fromAddress: "anna@example.test", subject })).toBe(
        true
      );
      expect(match({ subject, threadKey: "<root@own.test>" })).toBe("auto");
    }
    for (const subject of ["Oferta Q1", "Out of office hours", "Automatic reply to your offer", null, undefined]) {
      expect(isAutoReply({ autoSubmitted: null, precedence: null, fromAddress: "anna@example.test", subject })).toBe(
        false
      );
    }
  });
});

describe("addresses compare by the one address rule (03-T1, 03-T7)", () => {
  test("03-T1: the Turkish dotted capital I and the Greek final sigma match their plain forms", () => {
    expect(match({ fromAddress: "ilker@example.com" }, { toAddresses: ["İlker@Example.com"], ccAddresses: [] })).toBe(
      "subject"
    );
    expect(match({ fromAddress: "νίκοσ@example.gr" }, { toAddresses: ["νίκος@example.gr"], ccAddresses: [] })).toBe(
      "subject"
    );
  });

  test("03-T1: an own address in another spelling never closes", () => {
    expect(
      replyMatch(
        loop({ toAddresses: ["x@example.test"] }),
        mail({ fromAddress: "νίκος@example.gr", threadKey: "<root@own.test>" }),
        {
          ownAddresses: ["νίκοσ@example.gr"],
        }
      )
    ).toBeNull();
  });

  test("03-T7: the no-reply sender test ignores padding and case", () => {
    expect(isAutoReply({ autoSubmitted: null, precedence: null, fromAddress: " NO-REPLY@Example.com" })).toBe(true);
  });
});
