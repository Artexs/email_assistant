import { describe, expect, test } from "bun:test";

import { parseOrgSsoArgs } from "./org-sso-args";

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

  test("usage (null): no org id, a bad org id, a missing part, the secret as a value, two commands, strays", () => {
    const without = (flag: string): string[] => {
      const at = setArgs.indexOf(flag);
      return setArgs.filter((_, index) => index !== at && index !== at + (flag === "--client-secret-stdin" ? 0 : 1));
    };
    expect(parseOrgSsoArgs([], none)).toBeNull();
    expect(parseOrgSsoArgs(["--set", "--issuer", "https://idp.x.test"], none)).toBeNull();
    expect(parseOrgSsoArgs(["--org-id", "nope"], none)).toBeNull();
    expect(parseOrgSsoArgs(without("--issuer"), none)).toBeNull();
    expect(parseOrgSsoArgs(without("--domain"), none)).toBeNull();
    expect(parseOrgSsoArgs(without("--client-id"), none)).toBeNull();
    expect(parseOrgSsoArgs(without("--client-secret-stdin"), none)).toBeNull();
    expect(parseOrgSsoArgs([...without("--client-secret-stdin"), "--client-secret", "foo"], none)).toBeNull();
    expect(parseOrgSsoArgs([...setArgs, "--client-secret", "foo"], none)).toBeNull();
    expect(parseOrgSsoArgs([...setArgs, "--remove"], none)).toBeNull();
    expect(parseOrgSsoArgs([...setArgs, "--confirm", "x.test"], none)).toBeNull();
    expect(parseOrgSsoArgs(["--org-id", orgId, "--remove"], none)).toBeNull();
    expect(parseOrgSsoArgs(["--org-id", orgId, "--remove", "--confirm", " "], none)).toBeNull();
    expect(parseOrgSsoArgs(["--org-id", orgId, "--confirm", "x.test"], none)).toBeNull();
    expect(parseOrgSsoArgs(["--org-id", orgId, "--domain", "x.test"], none)).toBeNull();
    expect(parseOrgSsoArgs(["--org-id", orgId, "stray"], none)).toBeNull();
  });

  test("the issuer: https always, http only for an allowed origin", () => {
    const withIssuer = (issuer: string): string[] =>
      setArgs.map((arg) => (arg === "https://idp.x.test" ? issuer : arg));
    expect(parseOrgSsoArgs(withIssuer("http://idp.x.test"), none)).toBeNull();
    expect(parseOrgSsoArgs(withIssuer("http://127.0.0.1:4000"), none)).toBeNull();
    expect(parseOrgSsoArgs(withIssuer("not a url"), none)).toBeNull();
    expect(parseOrgSsoArgs(withIssuer("ftp://idp.x.test"), none)).toBeNull();
    expect(parseOrgSsoArgs(withIssuer("http://127.0.0.1:4000"), { allowOrigins: ["http://127.0.0.1:4000"] })).toEqual({
      kind: "set",
      orgId,
      issuer: "http://127.0.0.1:4000",
      domain: "x.test",
      clientId: "cid",
    });
    expect(
      parseOrgSsoArgs(withIssuer("http://127.0.0.1:4001"), { allowOrigins: ["http://127.0.0.1:4000"] })
    ).toBeNull();
  });
});
