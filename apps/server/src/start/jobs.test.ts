import { describe, expect, test } from "bun:test";

import { startCalls, startSource } from "./source.test-helper";

// Every job that the start files schedule, and the ones that shutdown waits for (the run tracker). `mail.sync` and
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

const main = startSource();

const namesOf = (pattern: RegExp) => [...main.matchAll(pattern)].map((match) => match[1] ?? "").sort();

describe("the jobs of the start files", () => {
  test("the scheduled names are the 22 jobs", () => {
    expect(namesOf(/scheduler\.add\("([\w.]+)"/g)).toEqual([...WAITED_FOR, ...NOT_WAITED_FOR].sort());
  });

  test("shutdown waits for the 20 jobs that are tracked", () => {
    expect(namesOf(/runs\.track\("([\w.]+)"/g)).toEqual(WAITED_FOR);
  });
});

describe("the start order of main.ts", () => {
  // The order is the behaviour: the re-gate (in startTriage) runs before the committer exists (in startJobs), and the signal
  // handlers (in startHttp) exist before the line `server_listening`.
  test("main.ts calls the runtime starts in the order of the old start-up blocks", () => {
    expect(startCalls()).toEqual([
      "startMail",
      "startOperator",
      "startTriage",
      "startJobs",
      "startPush",
      "startTelegram",
      "startHttp",
    ]);
  });
});
