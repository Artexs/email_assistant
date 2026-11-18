import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// The capability page of the drafts names the two cases where the cost of a model call is not in the cap count, and the rule that
// the generic approval notice skips a reply send (F115 stage 07 review, N1 and N4). A page that loses these lines is a test failure.
const page = readFileSync(join(import.meta.dir, "../../../../../docs/capabilities/drafts-and-send.md"), "utf8");

describe("docs/capabilities/drafts-and-send.md, the drafter job", () => {
  test("the cost exceptions: a mail deleted during the call, and a crash between the call and the write of the rows", () => {
    expect(page).toContain("the row is lost when the mail is deleted during the call");
    expect(page).toContain("when the process dies between `draftReply` and the write of the rows");
  });

  test("the generic approval notice skips a reply send, and a timeout counts as a try", () => {
    expect(page).toContain("`listSendsToNotify` skips every `reply` send");
    expect(page).toContain("A hard error and a timeout count a try");
  });

  test("the limits of the answered check and the sweep (stage 09 re-review N-a to N-d)", () => {
    expect(page).toContain("*Unread Sent header (N-a).*");
    expect(page).toContain("*A client that sets no `\\Answered` (N-b).*");
    expect(page).toContain("a plus address");
    expect(page).toContain("*Starvation (N-c).*");
    expect(page).toContain("more than 1000 open reply sends");
    expect(page).toContain("*Two moves (N-d).*");
    expect(page).toContain("does not compare the current folder");
  });

  test("the Telegram review and the open consent step of stage 12", () => {
    expect(page).toContain("**Telegram review (F115 stage 12).**");
    expect(page).toContain("`listSendsToNotify` skips payload kind `reply` for good");
    expect(page).toContain("`approval:<send>:r<n>`");
    expect(page).toContain("**Open until stage 17:** `REPLY_CONSENT_SINCE` is a placeholder");
  });
});
