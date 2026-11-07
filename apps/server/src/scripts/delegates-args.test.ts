import { describe, expect, test } from "bun:test";

import { parseDelegatesArgs } from "./delegates-args";

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
    expect(parseDelegatesArgs(["add", "--org-id", org, "--name", "A"])).toBeUndefined();
    expect(parseDelegatesArgs(["add", "--org-id", org, "--name", "A", "--email", "nope"])).toBeUndefined();
    expect(parseDelegatesArgs(["add", "--org-id", org, "--name", " ", "--email", "a@b.pl"])).toBeUndefined();
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
    expect(parseDelegatesArgs(["enable", "--org-id", org, "--id", "x"])).toBeUndefined();
    expect(parseDelegatesArgs(["enable", "--org-id", org])).toBeUndefined();
  });

  test("bad input", () => {
    expect(parseDelegatesArgs([])).toBeUndefined();
    expect(parseDelegatesArgs(["nope", "--org-id", org])).toBeUndefined();
    expect(parseDelegatesArgs(["list"])).toBeUndefined();
    expect(parseDelegatesArgs(["list", "--org-id", "x"])).toBeUndefined();
    expect(parseDelegatesArgs(["list", "--org-id", org, "--id", id])).toBeUndefined();
    expect(parseDelegatesArgs(["list", "--org-id", org, "--unknown"])).toBeUndefined();
  });
});
