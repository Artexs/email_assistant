import { textTables } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { closeSendReasons } from "../../actions/close";

import { EXPIRY_REASONS } from "./send-result";

// `closeSend(notify: true)` leaves a result notice to the detector. A reason of `closeSendReasons` with no text there would
// be skipped with a warning and the owner would hear nothing, so the lists must agree.
describe("the result detector knows every close reason", () => {
  test("each reason of closeSend is in EXPIRY_REASONS and has an English and a Polish result text", () => {
    for (const reason of closeSendReasons) {
      expect(EXPIRY_REASONS as readonly string[]).toContain(reason);
      expect(textTables.en.approvals.sendResult.expired[reason]("Subject")).toContain("Subject");
      expect(textTables.pl.approvals.sendResult.expired[reason]("Subject")).toContain("Subject");
    }
  });
});
