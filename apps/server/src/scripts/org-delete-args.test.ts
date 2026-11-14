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

  test("a missing, empty or bad argument gives null", () => {
    expect(parseOrgDeleteArgs(["--org-id", ID])).toBeNull();
    expect(parseOrgDeleteArgs(["--confirm", "Acme"])).toBeNull();
    expect(parseOrgDeleteArgs(["--org-id", ID, "--confirm", "  "])).toBeNull();
    expect(parseOrgDeleteArgs(["--org-id", "nope", "--confirm", "Acme"])).toBeNull();
    expect(parseOrgDeleteArgs(["--org-id", ID, "--confirm", "Acme", "--force"])).toBeNull();
    expect(parseOrgDeleteArgs(["--org-id", ID, "--confirm", "Acme", "extra"])).toBeNull();
  });
});
