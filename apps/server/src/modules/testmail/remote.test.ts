import { sendLogLineSchema } from "@ea/core";
import { describe, expect, test } from "bun:test";

import {
  deliveredLogLines,
  findEnvValuesInBundle,
  parseDeliverOutput,
  remoteBundlePath,
  remoteCommand,
} from "./remote";
import type { RemoteTarget } from "./target";

const pilotTarget: RemoteTarget = {
  testAddress: "test@example.com",
  host: "home_vm",
  remoteDir: "~/email_assistant",
  composeArgs: "-f deploy/compose.yaml --env-file .env",
  orgId: "ac6ed6a2-ee37-461f-9632-cc08cf549e40",
  mailboxId: "8bc7f572-a7f5-4fa5-aaab-db16dc663e96",
};
const runId = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const bundlePath = remoteBundlePath(runId);
const base = `cd ~/email_assistant && docker compose -f deploy/compose.yaml --env-file .env run --rm -T -v ${bundlePath}:${bundlePath}:ro server bun ${bundlePath}`;
const ids = `--org-id ${pilotTarget.orgId} --mailbox-id ${pilotTarget.mailboxId}`;
const tail = `; code=$?; rm -f ${bundlePath}; exit $code`;

describe("remoteCommand", () => {
  test("builds the exact command", () => {
    expect(bundlePath).toBe(`/tmp/ea-testmail-${runId}.js`);
    expect(remoteCommand(pilotTarget, "deliver", { bundlePath })).toBe(`${base} deliver ${ids}${tail}`);
    expect(remoteCommand(pilotTarget, "compare", { bundlePath, bar: 0.98, minKept: 30 })).toBe(
      `${base} compare ${ids} --bar 0.98 --min-kept 30${tail}`
    );
    expect(remoteCommand(pilotTarget, "deliver", { bundlePath, checkOnly: true })).toBe(
      `${base} deliver ${ids} --check-only${tail}`
    );
    expect(() => remoteCommand(pilotTarget, "compare", { bundlePath, checkOnly: true })).toThrow();
  });

  test("rejects bad values", () => {
    expect(() => remoteCommand(pilotTarget, "compare", { bundlePath, bar: 2 })).toThrow();
    expect(() => remoteCommand(pilotTarget, "compare", { bundlePath, minKept: 0 })).toThrow();
    expect(() => remoteCommand(pilotTarget, "compare", { bundlePath, bar: 0 })).toThrow();
    expect(() => remoteCommand(pilotTarget, "deliver", { bundlePath, bar: 0.9 })).toThrow();
    expect(() => remoteCommand(pilotTarget, "deliver", { bundlePath, minKept: 5 })).toThrow();
    expect(() => remoteCommand(pilotTarget, "deliver", { bundlePath: "/tmp/x.js" })).toThrow();
    expect(() => remoteCommand(pilotTarget, "deliver", { bundlePath: "/tmp/ea-testmail-../x.js" })).toThrow();
    expect(() => remoteBundlePath("../x")).toThrow();
    expect(() => remoteCommand({ ...pilotTarget, host: "-oProxyCommand=x" }, "deliver", { bundlePath })).toThrow();
    expect(() => remoteCommand({ ...pilotTarget, extra: 1 } as RemoteTarget, "deliver", { bundlePath })).toThrow();
  });
});

describe("findEnvValuesInBundle", () => {
  test("returns key names of secret-like values found in the bundle", () => {
    expect(
      findEnvValuesInBundle("abc SECRETVALUE123 def", {
        FOO_KEY: "SECRETVALUE123",
        PATH: "SECRETVALUE123",
        SHORT_KEY: "abc",
      })
    ).toEqual(["FOO_KEY"]);
  });
});

describe("parseDeliverOutput", () => {
  const good1 = `{"case":"c1","result":"moved","folder":"offers"}`;
  const good2 = `{"case":"c2","result":"not_found","folder":null}`;
  const parsed = parseDeliverOutput(`${good1}\n[mail] deliver ...\n${good2}\n{"case":1}\n`);

  test("reads good lines and counts bad ones", () => {
    expect(parsed.lines).toEqual([
      { case: "c1", result: "moved", folder: "offers" },
      { case: "c2", result: "not_found", folder: null },
    ]);
    expect(parsed.bad).toBe(1);
  });

  test("counts broken JSON and unknown folders as bad", () => {
    const out = parseDeliverOutput(`{oops\n{"case":"c","result":"moved","folder":"x"}\n`);
    expect(out).toEqual({ lines: [], bad: 2 });
  });

  test("counts inconsistent result and folder pairs as bad", () => {
    const out = parseDeliverOutput(
      [
        `{"case":"a","result":"synced","folder":null}`,
        `{"case":"b","result":"moved","folder":"inbox"}`,
        `{"case":"c","result":"duplicate_removed","folder":"db"}`,
        `{"case":"d","result":"in_inbox","folder":"inbox"}`,
        `{"case":"e","result":"synced","folder":"db"}`,
        `{"case":"f","result":"synced","folder":"offers"}`,
        `{"case":"g","result":"in_inbox","folder":"db"}`,
        `{"case":"h","result":"not_found","folder":"inbox"}`,
        `{"case":"i","result":"moved","folder":"junk"}`,
      ].join("\n")
    );
    expect(out.bad).toBe(6);
    expect(out.lines.map((l) => l.case)).toEqual(["d", "e", "i"]);
  });

  test("log lines skip not_found", () => {
    const now = new Date("2026-11-08T10:00:00Z");
    const more = [...parsed.lines, { case: "c3", result: "synced" as const, folder: "db" as const }];
    const logLines = deliveredLogLines("b1", more, now);
    expect(logLines.map((l) => (l.type === "delivered" ? [l.case, l.folder, l.result] : null))).toEqual([
      ["c1", "offers", "moved"],
      ["c3", "db", "synced"],
    ]);
    for (const line of logLines) expect(sendLogLineSchema.safeParse(line).success).toBe(true);
  });
});
