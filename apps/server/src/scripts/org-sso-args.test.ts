import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOrgSsoArgs } from "./org-sso-args";

// A usage error: a `UsageError` of the parser, or a `parseArgs` error (unknown flag, missing value), which `runCli` maps to exit 2 as well.
function isUsageError(run: () => unknown): boolean {
  try {
    run();
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    return error instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_"));
  }
  return false;
}

const orgId = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11";
const none = { allowOrigins: [] as string[] };
const setArgs = [
  "--org-id",
  orgId,
  "--set",
  "--issuer",
  "https://idp.x.test",
  "--domain",
  "x.test",
  "--client-id",
  "cid",
  "--client-secret-stdin",
];

describe("parseOrgSsoArgs", () => {
  test("show, set and remove", () => {
    expect(parseOrgSsoArgs(["--org-id", orgId], none)).toEqual({ kind: "show", orgId });
    expect(parseOrgSsoArgs(setArgs, none)).toEqual({
      kind: "set",
      orgId,
      issuer: "https://idp.x.test",
      domain: "x.test",
      clientId: "cid",
    });
    expect(parseOrgSsoArgs(["--org-id", orgId, "--remove", "--confirm", "x.test"], none)).toEqual({
      kind: "remove",
      orgId,
      confirm: "x.test",
    });
  });

  test("verify, attest and require", () => {
    expect(parseOrgSsoArgs(["--org-id", orgId, "--verify"], none)).toEqual({ kind: "verify", orgId });
    expect(parseOrgSsoArgs(["--org-id", orgId, "--attest", "--confirm", "x.test"], none)).toEqual({
      kind: "attest",
      orgId,
      confirm: "x.test",
    });
    expect(parseOrgSsoArgs(["--org-id", orgId, "--require", "on"], none)).toEqual({
      kind: "require",
      orgId,
      required: true,
    });
    expect(parseOrgSsoArgs(["--org-id", orgId, "--require", "off"], none)).toEqual({
      kind: "require",
      orgId,
      required: false,
    });
  });

  test("usage error for verify, attest and require: bad value, no confirm, two commands, a stray", () => {
    const base = ["--org-id", orgId];
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--require", "yes"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--require"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--attest"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--attest", "--confirm", " "], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--verify", "--confirm", "x.test"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--require", "on", "--confirm", "x.test"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--verify", "--attest", "--confirm", "x.test"], none))).toBe(
      true
    );
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--verify", "--require", "on"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--verify", "--remove", "--confirm", "x.test"], none))).toBe(
      true
    );
    expect(isUsageError(() => parseOrgSsoArgs([...base, "--verify", "--domain", "x.test"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...setArgs, "--verify"], none))).toBe(true);
  });

  test("usage error: no org id, a bad org id, a missing part, the secret as a value, two commands, strays", () => {
    const without = (flag: string): string[] => {
      const at = setArgs.indexOf(flag);
      return setArgs.filter((_, index) => index !== at && index !== at + (flag === "--client-secret-stdin" ? 0 : 1));
    };
    expect(isUsageError(() => parseOrgSsoArgs([], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(["--set", "--issuer", "https://idp.x.test"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(["--org-id", "nope"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(without("--issuer"), none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(without("--domain"), none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(without("--client-id"), none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(without("--client-secret-stdin"), none))).toBe(true);
    expect(
      isUsageError(() => parseOrgSsoArgs([...without("--client-secret-stdin"), "--client-secret", "foo"], none))
    ).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...setArgs, "--client-secret", "foo"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...setArgs, "--remove"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs([...setArgs, "--confirm", "x.test"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(["--org-id", orgId, "--remove"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(["--org-id", orgId, "--remove", "--confirm", " "], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(["--org-id", orgId, "--confirm", "x.test"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(["--org-id", orgId, "--domain", "x.test"], none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(["--org-id", orgId, "stray"], none))).toBe(true);
  });

  test("the issuer: https always, http only for an allowed origin", () => {
    const withIssuer = (issuer: string): string[] =>
      setArgs.map((arg) => (arg === "https://idp.x.test" ? issuer : arg));
    expect(isUsageError(() => parseOrgSsoArgs(withIssuer("http://idp.x.test"), none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(withIssuer("http://127.0.0.1:4000"), none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(withIssuer("not a url"), none))).toBe(true);
    expect(isUsageError(() => parseOrgSsoArgs(withIssuer("ftp://idp.x.test"), none))).toBe(true);
    expect(parseOrgSsoArgs(withIssuer("http://127.0.0.1:4000"), { allowOrigins: ["http://127.0.0.1:4000"] })).toEqual({
      kind: "set",
      orgId,
      issuer: "http://127.0.0.1:4000",
      domain: "x.test",
      clientId: "cid",
    });
    expect(
      isUsageError(() =>
        parseOrgSsoArgs(withIssuer("http://127.0.0.1:4001"), { allowOrigins: ["http://127.0.0.1:4000"] })
      )
    ).toBe(true);
  });
});
