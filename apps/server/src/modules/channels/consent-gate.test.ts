import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "bun:test";

// The consent gate of open-loop data has one choke point, `loopConsentOf`. These tests read the
// sources, so a new sender of loop data that skips the gate fails here, not in production.
const SRC = join(import.meta.dir, "..", "..");
const sources = [...new Bun.Glob("**/*.ts").scanSync({ cwd: SRC })]
  .filter((file) => !file.endsWith(".test.ts"))
  .map((file) => ({ file, text: readFileSync(join(SRC, file), "utf8") }));
const usersOf = (needle: RegExp) =>
  sources
    .filter(({ text }) => needle.test(text))
    .map(({ file }) => file)
    .sort();

describe("the consent gate of open-loop data", () => {
  test("only consent.ts compares a consent version with the open-loops version", () => {
    expect(usersOf(/\bconsentCovers\b/)).toEqual(["modules/channels/consent.ts"]);
    expect(usersOf(/\bOPEN_LOOPS_CONSENT_SINCE\b/)).toEqual(["modules/channels/consent.ts"]);
  });

  test("only the gate of the notices, the digest job (and the gate itself) calls loopConsentOf; the raw version reader has no other caller", () => {
    expect(usersOf(/\bloopConsentOf\(/)).toEqual([
      "modules/channels/consent.ts",
      "modules/channels/digest-job.ts", // the brief of the first digest of the day
      "modules/channels/notices/loop-consent.ts",
    ]);
    expect(usersOf(/\bconsentVersionsOf\(/)).toEqual(["modules/channels/consent.ts"]);
  });

  test("a notice file that queues a row for a loop is on the list; the files that carry loop data use the gate", () => {
    const queuesLoopRows = usersOf(/\bloopId:\s|\bloopId\b[^:]*\?\s*\{\}/).filter((file) =>
      file.startsWith("modules/channels/")
    );
    const known = [
      "modules/channels/card-edits.ts", // the edit of an existing card: only a covered owner holds a card
      "modules/channels/loop-cards.ts", // the edit of a delivered card after the Sent switch off: a fixed text of ours, no loop data
      "modules/channels/notices/action-failed.ts", // a fixed text, no loop data
      "modules/channels/notices/approval.ts", // loop data: gated
      "modules/channels/notices/send-result.ts", // loop data: gated
    ];
    const queuing = queuesLoopRows.filter((file) =>
      /\bqueue(Notice)?\(/.test(sources.find((s) => s.file === file)?.text ?? "")
    );
    expect(queuing).toEqual(known);
    for (const file of ["modules/channels/notices/approval.ts", "modules/channels/notices/send-result.ts"]) {
      expect(sources.find((s) => s.file === file)?.text, relative(SRC, file)).toContain("splitByLoopConsent(");
    }
  });

  test("the brief is built only where the member's consent is read: a caller that sets the loop part of a digest calls the gate", () => {
    // `firstOfDay` is the field that switches the brief on (`DigestLoops`): every file that sets it reads the gate and passes `loopConsent`.
    const setters = usersOf(/\bfirstOfDay\b/).filter(
      (file) => file !== "modules/reports/digest.ts" && file !== "modules/reports/digest-brief.ts"
    );
    expect(setters).toEqual(["modules/channels/digest-job.ts"]);
    const job = sources.find((s) => s.file === "modules/channels/digest-job.ts")?.text ?? "";
    expect(job).toMatch(/loopConsent\s*=\s*\(await loopConsentOf\(/);
    expect(job).toMatch(/loops = \{ firstOfDay, loopConsent/);
    // The digest on demand has no loop part: no brief, no count line.
    const commands = sources.find((s) => s.file === "modules/channels/commands.ts")?.text ?? "";
    expect(commands).not.toMatch(/\bloops:/);
  });

  // Reply-draft data has the same kind of choke point.
  test("only consent.ts compares a consent version with the reply version; only the reply notice and the review taps call replyConsentOf", () => {
    expect(usersOf(/\bREPLY_CONSENT_SINCE\b/)).toEqual(["modules/channels/consent.ts"]);
    expect(usersOf(/\breplyConsentOf\(/)).toEqual([
      "modules/channels/commands.ts", // the Draft reply button of the digest on demand
      "modules/channels/consent.ts",
      "modules/channels/digest-job.ts", // the Draft reply button of a scheduled digest
      "modules/channels/notices/replies-ready.ts",
      "modules/channels/notices/reply-results.ts", // the card that follows a request
      "modules/channels/notices/urgent.ts", // the Draft reply button of an urgent notice
      "modules/channels/reply-redraft.ts", // the line of text after Redraft
      "modules/channels/reply-taps.ts",
    ]);
  });

  test("every file that queues a review card or reads a reply for a card goes through the gate: the taps check the consent first", () => {
    const taps = sources.find((s) => s.file === "modules/channels/reply-taps.ts")?.text ?? "";
    // The tap handler checks the consent before it reads a reply, and the step after a decision checks it again.
    expect(taps.indexOf("replyConsentOf(")).toBeGreaterThan(-1);
    expect(taps.indexOf("replyConsentOf(")).toBeLessThan(taps.indexOf("queueNextReviewCard("));
    // The only callers of the review card queue are the tap code.
    expect(usersOf(/\bqueueNextReviewCard\(|\bqueueReviewCard\(/)).toEqual([
      "modules/channels/reply-review.ts",
      "modules/channels/reply-taps.ts",
    ]);
    // The card of one named send (a new version, a draft that a tap found, the answer to a request) has three callers. The taps that
    // change a reply run after the check of `handleReplyCallback`; the result detector checks the consent itself.
    expect(usersOf(/\bqueueReviewCardOfSend\(/)).toEqual([
      "modules/channels/notices/reply-results.ts",
      "modules/channels/reply-redraft.ts",
      "modules/channels/reply-review.ts",
    ]);
    expect(taps.indexOf("replyConsentOf(")).toBeLessThan(taps.indexOf("handleReplyChangeTap(deps"));
    const results = sources.find((s) => s.file === "modules/channels/notices/reply-results.ts")?.text ?? "";
    expect(results.indexOf("replyConsentOf(")).toBeGreaterThan(-1);
    expect(results.indexOf("replyConsentOf(")).toBeLessThan(results.indexOf("await answerCard("));
    expect(results.match(/queueReviewCardOfSend\(/g)).toHaveLength(1);
  });
});
