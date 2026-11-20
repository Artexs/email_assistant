import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseDelegationsArgs } from "./delegations-args";

const org = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";

describe("parseDelegationsArgs", () => {
  test("list defaults", () => {
    expect(parseDelegationsArgs(["list", "--org-id", org])).toEqual({
      kind: "list",
      orgId: org,
      status: undefined,
      limit: 50,
    });
  });

  test("list with status and limit", () => {
    expect(parseDelegationsArgs(["list", "--org-id", org, "--status", "overdue", "--limit", "5"])).toEqual({
      kind: "list",
      orgId: org,
      status: "overdue",
      limit: 5,
    });
  });

  test("list fails on a bad status or limit", () => {
    expect(() => parseDelegationsArgs(["list", "--org-id", org, "--status", "nope"])).toThrow(UsageError);
    expect(() => parseDelegationsArgs(["list", "--org-id", org, "--limit", "0"])).toThrow(UsageError);
    expect(() => parseDelegationsArgs(["list", "--org-id", org, "--limit", "abc"])).toThrow(UsageError);
    expect(() => parseDelegationsArgs(["list", "--org-id", org, "--limit", "-3"])).toThrow(UsageError);
  });

  test("done", () => {
    expect(parseDelegationsArgs(["done", "--org-id", org, "--id", id])).toEqual({ kind: "done", orgId: org, id });
    expect(() => parseDelegationsArgs(["done", "--org-id", org])).toThrow(UsageError);
    expect(() => parseDelegationsArgs(["done", "--org-id", org, "--id", id, "--status", "sent"])).toThrow(UsageError);
  });

  test("bad input", () => {
    expect(() => parseDelegationsArgs([])).toThrow(UsageError);
    expect(() => parseDelegationsArgs(["nope", "--org-id", org])).toThrow(UsageError);
    expect(() => parseDelegationsArgs(["list"])).toThrow(UsageError);
  });
});
