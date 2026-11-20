import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { cliDescriptions, parseDelegatesArgs } from "./delegates-args";

const org = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";

describe("parseDelegatesArgs", () => {
  test("add", () => {
    expect(parseDelegatesArgs(["add", "--org-id", org, "--name", " Anna ", "--email", "Anna@Example.com"])).toEqual({
      kind: "add",
      orgId: org,
      name: "Anna",
      email: "anna@example.com",
      tags: [],
    });
  });

  test("add normalizes tags", () => {
    expect(
      parseDelegatesArgs(["add", "--org-id", org, "--name", "A", "--email", "a@b.pl", "--tags", " A, b ,a"])
    ).toMatchObject({ tags: ["a", "b"] });
  });

  test("add fails without --email, with a bad email or an empty name", () => {
    expect(() => parseDelegatesArgs(["add", "--org-id", org, "--name", "A"])).toThrow(UsageError);
    expect(() => parseDelegatesArgs(["add", "--org-id", org, "--name", "A", "--email", "nope"])).toThrow(UsageError);
    expect(() => parseDelegatesArgs(["add", "--org-id", org, "--name", " ", "--email", "a@b.pl"])).toThrow(UsageError);
  });

  test("list", () => {
    expect(parseDelegatesArgs(["list", "--org-id", org])).toEqual({ kind: "list", orgId: org, all: false });
    expect(parseDelegatesArgs(["list", "--org-id", org, "--all"])).toEqual({ kind: "list", orgId: org, all: true });
  });

  test("disable and enable", () => {
    expect(parseDelegatesArgs(["disable", "--org-id", org, "--id", id])).toEqual({
      kind: "disable",
      orgId: org,
      id,
    });
    expect(parseDelegatesArgs(["enable", "--org-id", org, "--id", id])).toEqual({ kind: "enable", orgId: org, id });
    expect(() => parseDelegatesArgs(["enable", "--org-id", org, "--id", "x"])).toThrow(UsageError);
    expect(() => parseDelegatesArgs(["enable", "--org-id", org])).toThrow(UsageError);
  });

  test("bad input", () => {
    expect(() => parseDelegatesArgs([])).toThrow(UsageError);
    expect(() => parseDelegatesArgs(["nope", "--org-id", org])).toThrow(UsageError);
    expect(() => parseDelegatesArgs(["list"])).toThrow(UsageError);
    expect(() => parseDelegatesArgs(["list", "--org-id", "x"])).toThrow(UsageError);
    expect(() => parseDelegatesArgs(["list", "--org-id", org, "--id", id])).toThrow(UsageError);
    expect(() => parseDelegatesArgs(["list", "--org-id", org, "--unknown"])).toThrow(UsageError);
  });

  test("a well-formed address is never a usage error: the service refuses a mailbox address of the organization (exit 1)", () => {
    expect(parseDelegatesArgs(["add", "--org-id", org, "--name", "A", "--email", "mailbox@org.test"])).toMatchObject({
      kind: "add",
      email: "mailbox@org.test",
    });
  });

  test("each package.json name has one description with its subcommand", () => {
    expect(cliDescriptions.map((item) => [item.name, item.subcommand])).toEqual([
      ["delegates:add", "add"],
      ["delegates:list", "list"],
      ["delegates:disable", "disable"],
      ["delegates:enable", "enable"],
    ]);
  });
});
