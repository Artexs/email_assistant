import { describe, expect, test } from "bun:test";

import { parseOrgDeleteArgs } from "./org-delete-args";

const ID = "11111111-1111-4111-8111-111111111111";

describe("parseOrgDeleteArgs", () => {
  test("a uuid and a name parse", () => {
    expect(parseOrgDeleteArgs(["--org-id", ID, "--confirm", "Acme Test"])).toEqual({
      orgId: ID,
      confirmName: "Acme Test",
    });
  });

  test("an optional lock timeout parses; a bad one throws a usage error", () => {
    expect(parseOrgDeleteArgs(["--org-id", ID, "--confirm", "Acme", "--lock-timeout-ms", "200"])).toEqual({
      orgId: ID,
      confirmName: "Acme",
      lockTimeoutMs: 200,
    });
    expect(() => parseOrgDeleteArgs(["--org-id", ID, "--confirm", "Acme", "--lock-timeout-ms", "0"])).toThrow();
    expect(() => parseOrgDeleteArgs(["--org-id", ID, "--confirm", "Acme", "--lock-timeout-ms", "x"])).toThrow();
  });

  test("a missing, empty or bad argument throws a usage error", () => {
    expect(() => parseOrgDeleteArgs(["--org-id", ID])).toThrow();
    expect(() => parseOrgDeleteArgs(["--confirm", "Acme"])).toThrow();
    expect(() => parseOrgDeleteArgs(["--org-id", ID, "--confirm", "  "])).toThrow();
    expect(() => parseOrgDeleteArgs(["--org-id", "nope", "--confirm", "Acme"])).toThrow();
    expect(() => parseOrgDeleteArgs(["--org-id", ID, "--confirm", "Acme", "--force"])).toThrow();
    expect(() => parseOrgDeleteArgs(["--org-id", ID, "--confirm", "Acme", "extra"])).toThrow();
  });
});
