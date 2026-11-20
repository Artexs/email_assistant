import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { describe, expect, test } from "bun:test";

import { parseOrgDsrArgs } from "./org-dsr-args";

const ID = "11111111-1111-4111-8111-111111111111";
const recipient = await identityToRecipient(await generateX25519Identity());

describe("parseOrgDsrArgs", () => {
  test("find with and without a report parses", () => {
    expect(parseOrgDsrArgs(["--org-id", ID, "--address", "p@x.test", "--find"])).toEqual({
      orgId: ID,
      address: "p@x.test",
      mode: "find",
    });
    expect(
      parseOrgDsrArgs([
        "--org-id",
        ID,
        "--address",
        "p@x.test",
        "--find",
        "--recipient",
        recipient,
        "--out",
        "/tmp/r.age",
      ])
    ).toEqual({ orgId: ID, address: "p@x.test", mode: "find", report: { recipient, out: "/tmp/r.age" } });
  });

  test("a usage error: no mode, half a report, a bad key, a bad id", () => {
    expect(() => parseOrgDsrArgs(["--org-id", ID, "--address", "p@x.test"])).toThrow();
    expect(() =>
      parseOrgDsrArgs(["--org-id", ID, "--address", "p@x.test", "--find", "--recipient", recipient])
    ).toThrow();
    expect(() => parseOrgDsrArgs(["--org-id", ID, "--address", "p@x.test", "--find", "--out", "/tmp/r.age"])).toThrow();
    expect(() =>
      parseOrgDsrArgs([
        "--org-id",
        ID,
        "--address",
        "p@x.test",
        "--find",
        "--recipient",
        "hunter2",
        "--out",
        "/tmp/r.age",
      ])
    ).toThrow();
    expect(() => parseOrgDsrArgs(["--org-id", "nope", "--address", "p@x.test", "--find"])).toThrow();
    expect(() => parseOrgDsrArgs(["--org-id", ID, "--address", " ", "--find"])).toThrow();
    expect(() => parseOrgDsrArgs(["--org-id", ID, "--find"])).toThrow();
  });

  test("a bad address is no usage error", () => {
    expect(() => parseOrgDsrArgs(["--org-id", ID, "--address", "p@x.", "--find"])).not.toThrow();
  });

  test("--rule-check with --org-id alone is the rule_check mode; any other option is a usage error", () => {
    expect(parseOrgDsrArgs(["--org-id", ID, "--rule-check"])).toEqual({ mode: "rule_check", orgId: ID });
    expect(() => parseOrgDsrArgs(["--org-id", ID, "--rule-check", "--address", "p@x.test"])).toThrow();
    expect(() => parseOrgDsrArgs(["--org-id", ID, "--rule-check", "--find"])).toThrow();
    expect(() => parseOrgDsrArgs(["--rule-check"])).toThrow();
  });
});
