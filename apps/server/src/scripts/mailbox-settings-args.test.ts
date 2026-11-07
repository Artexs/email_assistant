import { describe, expect, test } from "bun:test";

import { parseSettingsArgs } from "./mailbox-settings-args";

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
    expect(parseSettingsArgs(["mode", ...ids, "--mode", "live"])).toBeUndefined();
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
    expect(parseSettingsArgs(["auto", ...ids, "--category", "unsure", "--value", "on"])).toBeUndefined();
    expect(parseSettingsArgs(["auto", ...ids, "--category", "delegation", "--value", "on"])).toBeUndefined();
    expect(parseSettingsArgs(["auto", ...ids, "--category", "info", "--value", "maybe"])).toBeUndefined();
    expect(
      parseSettingsArgs(["auto", ...ids, "--category", "info", "--value", "on", "--threshold", "1.5"])
    ).toBeUndefined();
    expect(
      parseSettingsArgs(["auto", ...ids, "--category", "info", "--value", "on", "--threshold", "0"])
    ).toBeUndefined();
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
    expect(parseSettingsArgs(["switch", ...ids, "--name", "send", "--value", "on"])).toBeUndefined();
  });

  test("refuses a missing command, a bad id or a foreign flag", () => {
    expect(parseSettingsArgs([...ids])).toBeUndefined();
    expect(parseSettingsArgs(["show", "--org-id", "x", "--mailbox-id", mailbox])).toBeUndefined();
    expect(parseSettingsArgs(["show", ...ids, "--force"])).toBeUndefined();
    expect(parseSettingsArgs(["show", "extra", ...ids])).toBeUndefined();
  });
});
