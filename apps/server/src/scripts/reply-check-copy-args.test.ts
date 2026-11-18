import { describe, expect, test } from "bun:test";

import { readCheckCopyOptions, usage } from "./reply-check-copy-args";

const org = "11111111-1111-4111-8111-111111111111";
const action = "22222222-2222-4222-8222-222222222222";

describe("readCheckCopyOptions", () => {
  test("both ids", () => {
    expect(readCheckCopyOptions(["--org-id", org, "--action-id", action])).toEqual({ orgId: org, actionId: action });
  });

  test("a missing, bad or extra argument gives undefined", () => {
    expect(readCheckCopyOptions(["--action-id", action])).toBeUndefined();
    expect(readCheckCopyOptions(["--org-id", org])).toBeUndefined();
    expect(readCheckCopyOptions(["--org-id", "x", "--action-id", action])).toBeUndefined();
    expect(readCheckCopyOptions(["--org-id", org, "--action-id", "not-a-uuid"])).toBeUndefined();
    expect(readCheckCopyOptions(["--org-id", org, "--action-id", action, "--write"])).toBeUndefined();
  });

  test("the usage names the four words and says it never writes", () => {
    for (const word of ["same", "changed", "missing", "no_baseline", "never writes"]) expect(usage).toContain(word);
  });
});
