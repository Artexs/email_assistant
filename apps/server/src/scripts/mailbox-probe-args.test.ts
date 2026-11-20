import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { cliDescriptions, parseMailboxProbeArgs, probeSubOf } from "./mailbox-probe-args";

const base = ["--host", "imap.example.test", "--port", "993", "--address", "probe@example.test"];
const sendExtra = ["--smtp-host", "smtp.example.test", "--smtp-port", "465", "--to", "probe@example.test"];

describe("parseMailboxProbeArgs", () => {
  test("move: parses the move shape", () => {
    expect(parseMailboxProbeArgs(["move", ...base])).toEqual({
      sub: "move",
      host: "imap.example.test",
      port: 993,
      address: "probe@example.test",
    });
  });

  test("send: parses the send shape", () => {
    expect(parseMailboxProbeArgs(["send", ...base, ...sendExtra])).toEqual({
      sub: "send",
      host: "imap.example.test",
      port: 993,
      address: "probe@example.test",
      smtpHost: "smtp.example.test",
      smtpPort: 465,
      to: "probe@example.test",
    });
  });

  test("move refuses a send-only flag", () => {
    expect(() => parseMailboxProbeArgs(["move", ...base, "--smtp-host", "x"])).toThrow(UsageError);
    expect(() => parseMailboxProbeArgs(["move", "--smtp-host", "x"])).toThrow(UsageError);
    expect(() => parseMailboxProbeArgs(["move", ...base, "--to", "probe@example.test"])).toThrow(UsageError);
  });

  test("send needs every send flag", () => {
    expect(() => parseMailboxProbeArgs(["send", ...base])).toThrow(UsageError);
    expect(() => parseMailboxProbeArgs(["send", ...base, "--smtp-host", "x", "--smtp-port", "465"])).toThrow(
      UsageError
    );
  });

  test("an unknown or missing subcommand is a usage error", () => {
    expect(() => parseMailboxProbeArgs(["drop"])).toThrow(UsageError);
    expect(() => parseMailboxProbeArgs(["drop", ...base])).toThrow(UsageError);
    expect(() => parseMailboxProbeArgs([])).toThrow(UsageError);
    expect(() => parseMailboxProbeArgs(base)).toThrow(UsageError);
  });

  test("a port outside 1..65535 is a usage error, in both subcommands", () => {
    for (const port of ["0", "70000", "-1", "1.5", "x", ""]) {
      const bad = ["--host", "h", "--port", port, "--address", "a@example.test"];
      expect(() => parseMailboxProbeArgs(["move", ...bad])).toThrow(UsageError);
      expect(() => parseMailboxProbeArgs(["send", ...bad, ...sendExtra])).toThrow(UsageError);
      expect(() =>
        parseMailboxProbeArgs(["send", ...base, "--smtp-host", "s", "--smtp-port", port, "--to", "a"])
      ).toThrow(UsageError);
    }
  });

  test("an unknown flag or an operand is a usage error", () => {
    expect(() => parseMailboxProbeArgs(["move", ...base, "--no-such-flag"])).toThrow(UsageError);
    expect(() => parseMailboxProbeArgs(["move", ...base, "extra"])).toThrow(UsageError);
  });
});

describe("usage", () => {
  test("probeSubOf reads only move and send", () => {
    expect(probeSubOf(["move"])).toBe("move");
    expect(probeSubOf(["send", "--host"])).toBe("send");
    expect(probeSubOf(["--help"])).toBeUndefined();
  });

  test("each subcommand has its own description with its own usage", () => {
    const byName = Object.fromEntries(cliDescriptions.map((item) => [item.name, item]));
    expect(byName["mailbox:probe-move"]?.subcommand).toBe("move");
    expect(byName["mailbox:probe-move"]?.usage).not.toContain("mailbox:probe-send");
    expect(byName["mailbox:probe-send"]?.subcommand).toBe("send");
    expect(byName["mailbox:probe-send"]?.usage).toContain("--smtp-host");
  });
});
