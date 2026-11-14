import { describe, expect, test } from "bun:test";

import { handledRow } from "./fixtures";
import { handledShare } from "./m4";

describe("handledShare", () => {
  test("counts handled and would-handle mail by the D14 rules", () => {
    const rows = [
      handledRow({ category: "info", mailboxActionApplied: true }),
      handledRow({ category: "info", mailboxActionApplied: true, mailboxActionUndone: true }),
      handledRow({ category: "notification", mailboxActionApplied: true, wrongWithin7Days: true }),
      handledRow({ category: "spam", mailboxActionLogged: true }),
      handledRow({ category: "delegation", delegationSendApplied: true }),
      handledRow({ category: "delegation", delegationSendApplied: true, delegationCancelled: true }),
      handledRow({ category: "urgent", mailboxActionApplied: true }),
      handledRow({ category: "needs_reply" }),
    ];
    expect(handledShare(rows)).toEqual({ triaged: 8, handled: 2, wouldHandle: 1 });
  });

  test("an empty week is all zeros", () => {
    expect(handledShare([])).toEqual({ triaged: 0, handled: 0, wouldHandle: 0 });
  });
});
