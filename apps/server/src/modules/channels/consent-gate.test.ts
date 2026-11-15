import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "bun:test";

// F116 stage 11 (review 17, N5): the consent gate of open-loop data has one choke point, `loopConsentOf`. These tests read the
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

  test("only the gate of the notices (and the gate itself) calls loopConsentOf; the raw version reader has no other caller", () => {
    expect(usersOf(/\bloopConsentOf\(/)).toEqual([
      "modules/channels/consent.ts",
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
});
