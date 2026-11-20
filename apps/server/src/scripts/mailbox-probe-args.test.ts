import { describe, expect, test } from "bun:test";

import { parseMailboxProbeArgs, probeSubOf, probeUsage } from "./mailbox-probe-args";

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
    expect(parseMailboxProbeArgs(["move", ...base, "--smtp-host", "x"])).toBeNull();
    expect(parseMailboxProbeArgs(["move", "--smtp-host", "x"])).toBeNull();
    expect(parseMailboxProbeArgs(["move", ...base, "--to", "probe@example.test"])).toBeNull();
  });

  test("send needs every send flag", () => {
    expect(parseMailboxProbeArgs(["send", ...base])).toBeNull();
    expect(parseMailboxProbeArgs(["send", ...base, "--smtp-host", "x", "--smtp-port", "465"])).toBeNull();
  });

  test("an unknown or missing subcommand is a usage error", () => {
    expect(parseMailboxProbeArgs(["drop"])).toBeNull();
    expect(parseMailboxProbeArgs(["drop", ...base])).toBeNull();
    expect(parseMailboxProbeArgs([])).toBeNull();
    expect(parseMailboxProbeArgs(base)).toBeNull();
  });

  test("a port outside 1..65535 is a usage error, in both subcommands", () => {
    for (const port of ["0", "70000", "-1", "1.5", "x", ""]) {
      const bad = ["--host", "h", "--port", port, "--address", "a@example.test"];
      expect(parseMailboxProbeArgs(["move", ...bad])).toBeNull();
      expect(parseMailboxProbeArgs(["send", ...bad, ...sendExtra])).toBeNull();
      expect(parseMailboxProbeArgs(["send", ...base, "--smtp-host", "s", "--smtp-port", port, "--to", "a"])).toBeNull();
    }
  });

  test("an unknown flag or an operand is a usage error", () => {
    expect(parseMailboxProbeArgs(["move", ...base, "--no-such-flag"])).toBeNull();
    expect(parseMailboxProbeArgs(["move", ...base, "extra"])).toBeNull();
  });
});

describe("usage", () => {
  test("probeSubOf reads only move and send", () => {
    expect(probeSubOf(["move"])).toBe("move");
    expect(probeSubOf(["send", "--host"])).toBe("send");
    expect(probeSubOf(["--help"])).toBeUndefined();
  });

  test("one subcommand shows its own usage; none shows both", () => {
    expect(probeUsage("move")).toContain("mailbox:probe-move");
    expect(probeUsage("move")).not.toContain("mailbox:probe-send");
    expect(probeUsage("send")).toContain("--smtp-host");
    expect(probeUsage(undefined)).toContain("mailbox:probe-move");
    expect(probeUsage(undefined)).toContain("mailbox:probe-send");
  });
});
