import { describe, expect, test } from "bun:test";

import { planDelivery, type FoundCopy } from "./delivery";

const SENDER = "ea-testmail-75wd@agentmail.to";

function copy(
  folder: FoundCopy["folder"],
  uid: number,
  messageId: string | null,
  from: string | null = SENDER
): FoundCopy {
  return { folder, uid, messageId, from };
}

function plan(wantedIds: string[], found: FoundCopy[], synced: string[] = []) {
  return planDelivery({
    wanted: wantedIds.map((messageId, index) => ({ caseId: `c${index}`, messageId })),
    sender: SENDER,
    syncedMessageIds: new Set(synced),
    found,
  });
}

describe("planDelivery", () => {
  test("one case per result kind, in the order of wanted", () => {
    const result = planDelivery({
      wanted: [
        { caseId: "synced", messageId: "<s@y.test>" },
        { caseId: "inbox", messageId: "<i@y.test>" },
        { caseId: "moved", messageId: "<m@y.test>" },
        { caseId: "dup", messageId: "<d@y.test>" },
        { caseId: "none", messageId: "<n@y.test>" },
      ],
      sender: SENDER,
      syncedMessageIds: new Set(["<s@y.test>"]),
      found: [
        copy("inbox", 1, "<i@y.test>"),
        copy("offers", 4, "<m@y.test>"),
        copy("inbox", 2, "<d@y.test>"),
        copy("junk", 9, "<d@y.test>"),
      ],
    });
    expect(result).toEqual([
      { caseId: "synced", result: "synced", folder: "db", ops: [] },
      { caseId: "inbox", result: "in_inbox", folder: "inbox", ops: [] },
      { caseId: "moved", result: "moved", folder: "offers", ops: [{ op: "move", folder: "offers", uid: 4 }] },
      { caseId: "dup", result: "duplicate_removed", folder: "junk", ops: [{ op: "delete", folder: "junk", uid: 9 }] },
      { caseId: "none", result: "not_found", folder: null, ops: [] },
    ]);
  });

  test("a wanted id with a trailing space still matches the synced row and the copies", () => {
    expect(plan(["<a@y.test> "], [copy("offers", 2, "<a@y.test>")], ["<a@y.test>"])).toEqual([
      { caseId: "c0", result: "synced", folder: "db", ops: [] },
    ]);
  });

  test("a synced case deletes the sort-folder copy only when an INBOX copy exists", () => {
    expect(
      plan(["<a@y.test>"], [copy("inbox", 1, "<a@y.test>"), copy("offers", 2, "<a@y.test>")], ["<a@y.test>"])
    ).toEqual([{ caseId: "c0", result: "synced", folder: "db", ops: [{ op: "delete", folder: "offers", uid: 2 }] }]);
    expect(plan(["<a@y.test>"], [copy("offers", 2, "<a@y.test>")], ["<a@y.test>"])).toEqual([
      { caseId: "c0", result: "synced", folder: "db", ops: [] },
    ]);
  });

  test("a message id with spaces matches the wanted id", () => {
    expect(plan(["<x@y.test>"], [copy("inbox", 1, " <x@y.test> ")])[0]?.result).toBe("in_inbox");
  });

  test("a copy with another sender, or with an unknown id, is ignored", () => {
    expect(
      plan(["<x@y.test>"], [copy("offers", 1, "<x@y.test>", "other@x.test"), copy("inbox", 2, "<x@y.test>", null)])[0]
    ).toEqual({
      caseId: "c0",
      result: "not_found",
      folder: null,
      ops: [],
    });
    expect(plan(["<x@y.test>"], [copy("offers", 1, "<other@y.test>"), copy("offers", 2, null)])[0]?.result).toBe(
      "not_found"
    );
  });

  test("several sort-folder copies: move the lowest UID of the first folder, delete the rest", () => {
    const found = [copy("junk", 3, "<x@y.test>"), copy("offers", 7, "<x@y.test>"), copy("offers", 5, "<x@y.test>")];
    expect(plan(["<x@y.test>"], found)[0]).toEqual({
      caseId: "c0",
      result: "moved",
      folder: "offers",
      ops: [
        { op: "move", folder: "offers", uid: 5 },
        { op: "delete", folder: "offers", uid: 7 },
        { op: "delete", folder: "junk", uid: 3 },
      ],
    });
  });

  test("the sender matches without case and spaces", () => {
    expect(plan(["<x@y.test>"], [copy("inbox", 1, "<x@y.test>", "EA-TestMail-75WD@AgentMail.to ")])[0]?.result).toBe(
      "in_inbox"
    );
  });
});
