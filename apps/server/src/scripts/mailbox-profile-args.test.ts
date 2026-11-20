import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { cliDescriptions, parseProfileArgs } from "./mailbox-profile-args";

const org = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";
const ids = ["--org-id", org, "--mailbox-id", mailbox];

describe("parseProfileArgs", () => {
  test("only the ids: a show command", () => {
    expect(parseProfileArgs(ids)).toEqual({ orgId: org, mailboxId: mailbox });
  });

  test("the name and the two files, each alone or together; an empty name is kept (it clears the field)", () => {
    expect(parseProfileArgs([...ids, "--display-name", "Anna Nowak"])).toEqual({
      orgId: org,
      mailboxId: mailbox,
      displayName: "Anna Nowak",
    });
    expect(parseProfileArgs([...ids, "--display-name", ""])).toMatchObject({ displayName: "" });
    expect(parseProfileArgs([...ids, "--signature-file", "/tmp/s.txt", "--style-file", "/tmp/w.txt"])).toEqual({
      orgId: org,
      mailboxId: mailbox,
      signatureFile: "/tmp/s.txt",
      styleFile: "/tmp/w.txt",
    });
  });

  test("a bad or missing id, an empty path, an unknown flag or a positional word is undefined", () => {
    expect(() => parseProfileArgs([])).toThrow(UsageError);
    expect(() => parseProfileArgs(["--mailbox-id", mailbox])).toThrow(UsageError);
    expect(() => parseProfileArgs(["--org-id", "x", "--mailbox-id", mailbox])).toThrow(UsageError);
    expect(() => parseProfileArgs([...ids, "--signature-file", ""])).toThrow(UsageError);
    expect(() => parseProfileArgs([...ids, "--signature", "text"])).toThrow(UsageError);
    expect(() => parseProfileArgs([...ids, "show"])).toThrow(UsageError);
  });

  test("the usage names the command and every flag", () => {
    for (const flag of ["--org-id", "--mailbox-id", "--display-name", "--signature-file", "--style-file"]) {
      expect(cliDescriptions[0]?.usage).toContain(flag);
    }
  });
});
