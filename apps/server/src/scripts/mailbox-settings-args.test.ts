import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { describeSentSync, describeUrgency, parseSettingsArgs, parseUrgencyFile, usage } from "./mailbox-settings-args";

const org = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";
const ids = ["--org-id", org, "--mailbox-id", mailbox];

describe("parseSettingsArgs", () => {
  test("show and expire-ready", () => {
    expect(parseSettingsArgs(["show", ...ids])).toEqual({ kind: "show", orgId: org, mailboxId: mailbox });
    expect(parseSettingsArgs(["expire-ready", ...ids])).toEqual({
      kind: "expire-ready",
      orgId: org,
      mailboxId: mailbox,
    });
  });

  test("mode", () => {
    expect(parseSettingsArgs(["mode", ...ids, "--mode", "assist"])).toEqual({
      kind: "mode",
      orgId: org,
      mailboxId: mailbox,
      mode: "assist",
      keepSwitches: false,
    });
    expect(parseSettingsArgs(["mode", ...ids, "--mode", "shadow", "--keep-switches"])).toMatchObject({
      mode: "shadow",
      keepSwitches: true,
    });
    expect(() => parseSettingsArgs(["mode", ...ids, "--mode", "live"])).toThrow(UsageError);
  });

  test("auto", () => {
    expect(
      parseSettingsArgs(["auto", ...ids, "--category", "info", "--value", "on", "--threshold", "0.95", "--force"])
    ).toEqual({
      kind: "auto",
      orgId: org,
      mailboxId: mailbox,
      category: "info",
      value: true,
      threshold: 0.95,
      force: true,
    });
    expect(parseSettingsArgs(["auto", ...ids, "--category", "spam", "--value", "off"])).toEqual({
      kind: "auto",
      orgId: org,
      mailboxId: mailbox,
      category: "spam",
      value: false,
      force: false,
    });
  });

  test("auto refuses bad input", () => {
    expect(() => parseSettingsArgs(["auto", ...ids, "--category", "unsure", "--value", "on"])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["auto", ...ids, "--category", "delegation", "--value", "on"])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["auto", ...ids, "--category", "info", "--value", "maybe"])).toThrow(UsageError);
    expect(() =>
      parseSettingsArgs(["auto", ...ids, "--category", "info", "--value", "on", "--threshold", "1.5"])
    ).toThrow(UsageError);
    expect(() =>
      parseSettingsArgs(["auto", ...ids, "--category", "info", "--value", "on", "--threshold", "0"])
    ).toThrow(UsageError);
  });

  test("switch", () => {
    expect(parseSettingsArgs(["switch", ...ids, "--name", "move", "--value", "off"])).toEqual({
      kind: "switch",
      orgId: org,
      mailboxId: mailbox,
      name: "move",
      value: false,
    });
    expect(parseSettingsArgs(["switch", ...ids, "--name", "create_draft", "--value", "on"])).toMatchObject({
      name: "create_draft",
    });
    expect(parseSettingsArgs(["switch", ...ids, "--name", "reply_drafts", "--value", "on"])).toEqual({
      kind: "switch",
      orgId: org,
      mailboxId: mailbox,
      name: "reply_drafts",
      value: true,
    });
    expect(usage).toContain("reply_drafts");
    expect(() => parseSettingsArgs(["switch", ...ids, "--name", "send", "--value", "on"])).toThrow(UsageError);
  });

  test("refuses a missing command, a bad id or a foreign flag", () => {
    expect(() => parseSettingsArgs([...ids])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["show", "--org-id", "x", "--mailbox-id", mailbox])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["show", ...ids, "--force"])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["show", "extra", ...ids])).toThrow(UsageError);
  });

  test("sync-folder", () => {
    expect(parseSettingsArgs(["sync-folder", ...ids, "--key", "junk", "--value", "off"])).toEqual({
      kind: "sync-folder",
      orgId: org,
      mailboxId: mailbox,
      key: "junk",
      value: false,
    });
    expect(() => parseSettingsArgs(["sync-folder", ...ids, "--key", "inbox", "--value", "off"])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["sync-folder", ...ids, "--key", "junk"])).toThrow(UsageError);
    expect(() =>
      parseSettingsArgs(["sync-folder", ...ids, "--key", "junk", "--value", "off", "--name", "move"])
    ).toThrow(UsageError);
  });
});

// Each subcommand takes only its own flags: a flag of another subcommand is a usage error.
describe("a flag of another subcommand", () => {
  test.each([
    ["show", ["--force"]],
    ["expire-ready", ["--value", "on"]],
    ["mode", ["--mode", "assist", "--value", "on"]],
    ["auto", ["--category", "info", "--value", "on", "--mode", "assist"]],
    ["switch", ["--name", "move", "--value", "on", "--key", "junk"]],
    ["sync-folder", ["--key", "junk", "--value", "on", "--name", "move"]],
    ["sent-sync", ["--value", "on", "--file", "p.json"]],
    ["urgency", ["--clear", "--keep-switches"]],
  ])("%s refuses it", (kind, flags) => {
    expect(() => parseSettingsArgs([kind, ...ids, ...flags])).toThrow(UsageError);
  });
});

describe("urgency", () => {
  test("takes --file or --clear, not none and not both", () => {
    expect(parseSettingsArgs(["urgency", ...ids, "--file", "p.json"])).toEqual({
      kind: "urgency",
      orgId: org,
      mailboxId: mailbox,
      source: { file: "p.json" },
    });
    expect(parseSettingsArgs(["urgency", ...ids, "--clear"])).toEqual({
      kind: "urgency",
      orgId: org,
      mailboxId: mailbox,
      source: { clear: true },
    });
    expect(() => parseSettingsArgs(["urgency", ...ids])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["urgency", ...ids, "--file", "p.json", "--clear"])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["urgency", ...ids, "--file", ""])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["urgency", ...ids, "--clear", "--value", "on"])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["show", ...ids, "--clear"])).toThrow(UsageError);
  });

  test("the usage names the command", () => {
    expect(usage).toContain("mailbox:settings urgency");
  });

  test("parseUrgencyFile: a profile; not JSON; schema errors as paths without values", () => {
    const ok = parseUrgencyFile(JSON.stringify({ topics: [{ label: "a" }] }));
    expect(ok).toEqual({ ok: true, profile: { topics: [{ label: "a", keywords: [] }], deadlines: [] } });
    expect(parseUrgencyFile("{ nope")).toEqual({ ok: false, reason: "not_json", paths: [] });
    const bad = parseUrgencyFile(JSON.stringify({ deadlines: [{ label: "SECRET", due: "SECRET" }], topics: "SECRET" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.paths.sort()).toEqual(["deadlines.0.due", "topics"]);
      expect(JSON.stringify(bad)).not.toContain("SECRET");
    }
    expect(parseUrgencyFile("[]")).toMatchObject({ ok: false, reason: "schema" });
  });

  test("describeUrgency prints counts", () => {
    expect(describeUrgency(null)).toBe("urgency none");
    expect(
      describeUrgency({ topics: [{ label: "SECRET", keywords: [] }], deadlines: [{ label: "x", due: "2026-12-01" }] })
    ).toBe("urgency topics=1 deadlines=1");
  });

  test("sent-sync: the command with on and off; without --value or with --key: undefined", () => {
    expect(parseSettingsArgs(["sent-sync", ...ids, "--value", "on"])).toEqual({
      kind: "sent-sync",
      orgId: org,
      mailboxId: mailbox,
      value: true,
    });
    expect(parseSettingsArgs(["sent-sync", ...ids, "--value", "off"])).toMatchObject({ value: false });
    expect(() => parseSettingsArgs(["sent-sync", ...ids])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["sent-sync", ...ids, "--value", "maybe"])).toThrow(UsageError);
    expect(() => parseSettingsArgs(["sent-sync", ...ids, "--value", "on", "--key", "junk"])).toThrow(UsageError);
    expect(usage).toContain("mailbox:settings sent-sync");
    expect(usage).toContain("only on the owner's instruction");
  });

  test("describeSentSync: null and a full view give the exact lines", () => {
    expect(describeSentSync(null)).toBe("sent: off (flag)");
    const view = {
      flagOn: true,
      enabled: true,
      folder: "Sent",
      firstPassDone: true,
      lastSentAt: "2026-11-20T10:00:00.000Z",
      storedCount: 12,
      errorCode: null,
    };
    expect(describeSentSync(view)).toBe(
      "sent: on, folder Sent, stored 12, last 2026-11-20T10:00:00.000Z, first pass done, error none"
    );
    expect(
      describeSentSync({
        flagOn: false,
        enabled: true,
        folder: null,
        firstPassDone: false,
        lastSentAt: null,
        storedCount: 0,
        errorCode: "no_folder",
      })
    ).toBe("sent: on, folder none, stored 0, last none, first pass pending, error no_folder, paused (flag off)");
    expect(describeSentSync({ ...view, enabled: false })).toContain("sent: off, folder Sent");
  });
});
