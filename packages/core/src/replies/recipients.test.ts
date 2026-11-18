import { describe, expect, test } from "bun:test";

import {
  otherParticipants,
  otherReplyTo,
  replyRecipients,
  sameRecipients,
  type ReplyRecipientFacts,
} from "./recipients";

const facts = (over: Partial<ReplyRecipientFacts> = {}): ReplyRecipientFacts => ({
  from: "anna@client.test",
  toAddresses: ["me@box.test", "b@y.test"],
  ccAddresses: ["c@z.test"],
  replyTo: [],
  own: ["me@box.test"],
  ...over,
});

describe("replyRecipients", () => {
  test("`all`: To is the sender; Cc is the other To and Cc addresses without an own mailbox, each once", () => {
    expect(replyRecipients("all", facts())).toEqual({
      kind: "ok",
      value: { to: ["anna@client.test"], cc: ["b@y.test", "c@z.test"], recipients: "all" },
    });
  });

  test("`all` compares in lower case and drops the sender, an own mailbox and a duplicate whatever its case", () => {
    const result = replyRecipients(
      "all",
      facts({
        toAddresses: ["Anna@Client.test", "ME@box.test", "B@y.test"],
        ccAddresses: ["b@Y.test", "c@z.test"],
      })
    );
    expect(result).toEqual({
      kind: "ok",
      value: { to: ["anna@client.test"], cc: ["B@y.test", "c@z.test"], recipients: "all" },
    });
  });

  test("`all` with exactly 10 other recipients works; with 11 it is `too_many_recipients`", () => {
    const others = (count: number) => Array.from({ length: count }, (_, index) => `p${index}@y.test`);
    const ten = replyRecipients("all", facts({ toAddresses: others(10), ccAddresses: [] }));
    expect(ten.kind).toBe("ok");
    expect(replyRecipients("all", facts({ toAddresses: others(6), ccAddresses: others(10).slice(6) }))).toEqual({
      kind: "ok",
      value: expect.objectContaining({ recipients: "all" }),
    });
    expect(replyRecipients("all", facts({ toAddresses: others(11), ccAddresses: [] }))).toEqual({
      kind: "too_many_recipients",
    });
  });

  test("`all` with no other participant is `no_others`", () => {
    expect(replyRecipients("all", facts({ toAddresses: ["me@box.test"], ccAddresses: [] }))).toEqual({
      kind: "no_others",
    });
  });

  test("`reply_to`: To is the first Reply-To address that is not the sender and not an own mailbox; no Cc", () => {
    const result = replyRecipients(
      "reply_to",
      facts({ replyTo: ["ANNA@client.test", "me@box.test", "office@client.test", "other@client.test"] })
    );
    expect(result).toEqual({
      kind: "ok",
      value: { to: ["office@client.test"], cc: [], recipients: "reply_to" },
    });
  });

  test("`reply_to` with none, or only the sender, is `no_reply_to`", () => {
    expect(replyRecipients("reply_to", facts())).toEqual({ kind: "no_reply_to" });
    expect(replyRecipients("reply_to", facts({ replyTo: ["Anna@client.test"] }))).toEqual({ kind: "no_reply_to" });
  });

  test("`from` is the default: the sender, no Cc", () => {
    expect(replyRecipients("from", facts())).toEqual({
      kind: "ok",
      value: { to: ["anna@client.test"], cc: [], recipients: "from" },
    });
  });
});

describe("the lists behind the buttons", () => {
  test("otherParticipants and otherReplyTo never list the sender or an own mailbox", () => {
    expect(otherParticipants(facts())).toEqual(["b@y.test", "c@z.test"]);
    expect(otherReplyTo(facts({ replyTo: ["anna@client.test", "me@box.test"] }))).toEqual([]);
  });

  test("sameRecipients ignores case and order", () => {
    expect(
      sameRecipients(
        { to: ["A@x.test"], cc: ["b@x.test", "c@x.test"] },
        { to: ["a@x.test"], cc: ["C@x.test", "b@x.test"] }
      )
    ).toBe(true);
    expect(sameRecipients({ to: ["a@x.test"], cc: [] }, { to: ["a@x.test"], cc: ["b@x.test"] })).toBe(false);
    expect(sameRecipients({ to: ["a@x.test"], cc: [] }, { to: ["z@x.test"], cc: [] })).toBe(false);
  });
});
