import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// Every job that main.ts schedules, and the ones that shutdown waits for (the run tracker). `mail.sync` and
// `platform.heartbeat` are not waited for: the mail sync stops with the scheduler and the heartbeat is one short call.
const WAITED_FOR = [
  "actions.committer",
  "actions.expiry",
  "channels.digest",
  "channels.notifier",
  "channels.operator",
  "channels.push",
  "channels.report_mail",
  "contacts.refresh",
  "loops.analyze",
  "loops.chaser",
  "loops.match",
  "ops.slo",
  "platform.retention",
  "replies.drafter",
  "replies.sweep",
  "triage.returned",
  "triage.worker",
  "trust.history",
  "trust.regate",
  "trust.tripwire",
];
const NOT_WAITED_FOR = ["mail.sync", "platform.heartbeat"];

const main = readFileSync(join(import.meta.dir, "../main.ts"), "utf8");

const namesOf = (pattern: RegExp) => [...main.matchAll(pattern)].map((match) => match[1] ?? "").sort();

describe("the jobs of main.ts", () => {
  test("the scheduled names are the 22 jobs", () => {
    expect(namesOf(/scheduler\.add\("([\w.]+)"/g)).toEqual([...WAITED_FOR, ...NOT_WAITED_FOR].sort());
  });

  test("shutdown waits for the 20 jobs that are tracked", () => {
    expect(namesOf(/runs\.track\("([\w.]+)"/g)).toEqual(WAITED_FOR);
  });
});
