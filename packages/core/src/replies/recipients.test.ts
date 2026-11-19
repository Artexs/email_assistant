import { describe, expect, test } from "bun:test";

import { bareAddress, ownAddressKey, replyRecipientsProblem } from "../triage/payloads";

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

// The rules that the review of the Telegram redraft left open, decided with the reply routes: Reply all and the Reply-To, a `+tag` variant of an own
// mailbox, and a stored address with a display name. The service, the card and the panel all call these functions.
describe("Reply all and the Reply-To of the mail", () => {
  const withReplyTo = facts({ replyTo: ["office@client.test"] });

  test("`all` goes to the sender in To and never uses the Reply-To: a Reply-To that is no other participant is not a recipient", () => {
    expect(replyRecipients("all", withReplyTo)).toEqual({
      kind: "ok",
      value: { to: ["anna@client.test"], cc: ["b@y.test", "c@z.test"], recipients: "all" },
    });
  });

  test("a Reply-To address that is also a participant is a recipient as a participant (Cc), not in To", () => {
    const result = replyRecipients("all", facts({ replyTo: ["b@y.test"] }));
    expect(result).toEqual({
      kind: "ok",
      value: { to: ["anna@client.test"], cc: ["b@y.test", "c@z.test"], recipients: "all" },
    });
  });

  test("`reply_to` is the explicit way to the Reply-To: To is that address", () => {
    expect(replyRecipients("reply_to", withReplyTo)).toEqual({
      kind: "ok",
      value: { to: ["office@client.test"], cc: [], recipients: "reply_to" },
    });
  });
});

describe("an own mailbox with a +tag", () => {
  test("`all` drops `me+x@box.test` and `ME+Y@Box.test` as the own mailbox `me@box.test`", () => {
    const result = replyRecipients(
      "all",
      facts({ toAddresses: ["me+x@box.test", "ME+Y@Box.test", "b@y.test"], ccAddresses: [] })
    );
    expect(result).toEqual({ kind: "ok", value: { to: ["anna@client.test"], cc: ["b@y.test"], recipients: "all" } });
    expect(otherParticipants(facts({ toAddresses: ["me+x@box.test"], ccAddresses: [] }))).toEqual([]);
  });

  test("a plus variant is own only on the same domain and only for an own local part; another person's +tag stays", () => {
    const own = ["me@box.test"];
    expect(ownAddressKey("Me+Tag@Box.test")).toBe("me@box.test");
    expect(ownAddressKey("+x@box.test")).toBe("+x@box.test");
    expect(ownAddressKey("me+x@other.test")).toBe("me@other.test");
    expect(
      otherParticipants(facts({ toAddresses: ["me+x@other.test", "jan+news@y.test"], ccAddresses: [], own }))
    ).toEqual(["me+x@other.test", "jan+news@y.test"]);
  });

  test("`reply_to` skips a plus variant of an own mailbox", () => {
    expect(replyRecipients("reply_to", facts({ replyTo: ["me+x@box.test"] }))).toEqual({ kind: "no_reply_to" });
  });

  test("replyRecipientsProblem refuses a plus variant of an own mailbox in Cc", () => {
    expect(replyRecipientsProblem({ to: ["a@x.test"], cc: ["me+x@box.test"] }, ["me@box.test"])).toBe("cc_own_mailbox");
    expect(replyRecipientsProblem({ to: ["a@x.test"], cc: ["me+x@other.test"] }, ["me@box.test"])).toBeNull();
  });
});

describe("a stored address with a display name", () => {
  test("`all` lists the bare address and the service schema accepts it", () => {
    const result = replyRecipients(
      "all",
      facts({ toAddresses: ['"Jan K." <jan@y.test>', "Ola <ola@y.test>", "me@box.test"], ccAddresses: [] })
    );
    expect(result).toEqual({
      kind: "ok",
      value: { to: ["anna@client.test"], cc: ["jan@y.test", "ola@y.test"], recipients: "all" },
    });
  });

  test("an entry that holds no valid address is no recipient: it does not count for the button or for the list", () => {
    const broken = ["not an address", "<>", "a@b@c", "x@y.test, z@y.test", "Name <a@y.test> <b@y.test>", ""];
    expect(otherParticipants(facts({ toAddresses: broken, ccAddresses: [] }))).toEqual([]);
    expect(replyRecipients("all", facts({ toAddresses: broken, ccAddresses: [] }))).toEqual({ kind: "no_others" });
    expect(otherReplyTo(facts({ replyTo: broken }))).toEqual([]);
  });

  test("a display name that looks like an address changes nothing: only the address in angle brackets counts", () => {
    expect(bareAddress("evil@x.test <jan@y.test>")).toBe("jan@y.test");
    expect(bareAddress("jan@y.test")).toBe("jan@y.test");
    expect(bareAddress("  jan@y.test  ")).toBe("jan@y.test");
    expect(bareAddress("jan@y.test <>")).toBeNull();
    expect(bareAddress("<<jan@y.test>>")).toBeNull();
  });

  test("the sender with a display name is the bare address in To; an unusable sender is `bad_recipient`", () => {
    expect(replyRecipients("from", facts({ from: "Anna <anna@client.test>" }))).toEqual({
      kind: "ok",
      value: { to: ["anna@client.test"], cc: [], recipients: "from" },
    });
    expect(replyRecipients("from", facts({ from: "nonsense" }))).toEqual({ kind: "bad_recipient" });
  });

  test("a Reply-To with a display name is listed bare, and the sender in a display-name form is still skipped", () => {
    expect(otherReplyTo(facts({ replyTo: ["Anna <ANNA@client.test>", "Biuro <office@client.test>"] }))).toEqual([
      "office@client.test",
    ]);
  });
});
