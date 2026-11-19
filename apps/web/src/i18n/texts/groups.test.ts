import { describe, expect, test } from "bun:test";

import { enActivity } from "./en-activity";
import { enApprovals } from "./en-approvals";
import { enAuth } from "./en-auth";
import { enMailboxes } from "./en-mailboxes";
import { enPhone } from "./en-phone";
import { enReply } from "./en-reply";
import { enReplyPanel } from "./en-reply-panel";
import { enSettings } from "./en-settings";
import { plActivity } from "./pl-activity";
import { plApprovals } from "./pl-approvals";
import { plAuth } from "./pl-auth";
import { plMailboxes } from "./pl-mailboxes";
import { plPhone } from "./pl-phone";
import { plReply } from "./pl-reply";
import { plReplyPanel } from "./pl-reply-panel";
import { plSettings } from "./pl-settings";

// `en.ts` and `pl.ts` spread these groups. A spread hides a key that two groups define (the later one wins), so the test checks it.
const groups = [
  ["auth", enAuth, plAuth],
  ["mailboxes", enMailboxes, plMailboxes],
  ["settings", enSettings, plSettings],
  ["activity", enActivity, plActivity],
  ["approvals", enApprovals, plApprovals],
  ["reply", enReply, plReply],
  ["reply panel", enReplyPanel, plReplyPanel],
  ["phone", enPhone, plPhone],
] as const;

describe("text groups", () => {
  test("no key is defined in two groups", () => {
    for (const side of [1, 2] as const) {
      const seen = new Map<string, string>();
      const repeated: string[] = [];
      for (const group of groups) {
        for (const key of Object.keys(group[side])) {
          const first = seen.get(key);
          if (first !== undefined) repeated.push(`${key} (${first}, ${group[0]})`);
          seen.set(key, group[0]);
        }
      }
      expect(repeated).toEqual([]);
    }
  });

  test("each English group has the same keys as its Polish group, in the same order", () => {
    for (const [name, en, pl] of groups) {
      expect([name, Object.keys(pl)]).toEqual([name, Object.keys(en)]);
    }
  });
});
