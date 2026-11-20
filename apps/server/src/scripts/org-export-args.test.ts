import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { describe, expect, test } from "bun:test";

import { parseOrgExportArgs } from "./org-export-args";

const ID = "11111111-1111-4111-8111-111111111111";
const recipient = await identityToRecipient(await generateX25519Identity());

describe("parseOrgExportArgs", () => {
  test("a uuid, a public key and a path parse", () => {
    expect(parseOrgExportArgs(["--org-id", ID, "--recipient", recipient, "--out", "/tmp/x.age"])).toEqual({
      orgId: ID,
      recipient,
      out: "/tmp/x.age",
    });
  });

  test("a missing or bad argument throws a usage error", () => {
    expect(() => parseOrgExportArgs(["--org-id", ID, "--recipient", recipient])).toThrow();
    expect(() => parseOrgExportArgs(["--org-id", ID, "--out", "/tmp/x.age"])).toThrow();
    expect(() => parseOrgExportArgs(["--recipient", recipient, "--out", "/tmp/x.age"])).toThrow();
    expect(() => parseOrgExportArgs(["--org-id", "nope", "--recipient", recipient, "--out", "/tmp/x.age"])).toThrow();
    expect(() => parseOrgExportArgs(["--org-id", ID, "--recipient", "hunter2", "--out", "/tmp/x.age"])).toThrow();
    expect(() => parseOrgExportArgs(["--org-id", ID, "--recipient", recipient, "--out", " "])).toThrow();
    expect(() =>
      parseOrgExportArgs(["--org-id", ID, "--recipient", recipient, "--out", "a", "--passphrase", "x"])
    ).toThrow();
  });
});
