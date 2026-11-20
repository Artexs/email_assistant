import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseMailboxConnectArgs } from "./mailbox-connect-args";

const org = "11111111-1111-4111-8111-111111111111";
const base = ["--org-id", org, "--address", "owner@example.test"];

describe("parseMailboxConnectArgs", () => {
  test("the defaults", () => {
    expect(parseMailboxConnectArgs(base)).toEqual({
      orgId: org,
      address: "owner@example.test",
      secretKind: "password",
      imapHost: "poczta.interia.pl",
      imapPort: 993,
      smtpHost: "poczta.interia.pl",
      smtpPort: 465,
      smtpSecurity: "tls",
    });
  });

  test("every flag", () => {
    expect(
      parseMailboxConnectArgs([
        ...base,
        ...["--secret-kind", "app_password", "--imap-host", "imap.example.test", "--imap-port", "1993"],
        ...["--smtp-host", "smtp.example.test", "--smtp-port", "587", "--smtp-security", "starttls"],
      ])
    ).toEqual({
      orgId: org,
      address: "owner@example.test",
      secretKind: "app_password",
      imapHost: "imap.example.test",
      imapPort: 1993,
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpSecurity: "starttls",
    });
  });

  test.each([
    ["a missing --address", ["--org-id", org]],
    ["an org id that is no uuid", ["--org-id", "x", "--address", "owner@example.test"]],
    ["a kind that is not in the list", [...base, "--secret-kind", "oauth"]],
    ["a security that is not in the list", [...base, "--smtp-security", "ssl"]],
    ["an IMAP port of 0", [...base, "--imap-port", "0"]],
    ["an IMAP port above 65535", [...base, "--imap-port", "70000"]],
    ["an SMTP port that is no number", [...base, "--smtp-port", "x"]],
    ["an SMTP port with a fraction", [...base, "--smtp-port", "46.5"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseMailboxConnectArgs(argv)).toThrow(UsageError);
  });
});
