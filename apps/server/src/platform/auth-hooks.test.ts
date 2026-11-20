import { APIError } from "better-auth/api";
import { describe, expect, test } from "bun:test";

import { createAuth, type AuthDeps } from "./auth";
import {
  authHookParts,
  runAfter,
  runBefore,
  type AuthHookCtx,
  type AuthHookPart,
  type AuthPartContext,
} from "./auth-hooks";
import { createResetLimiter } from "./auth-password";

const ctx = { path: "/sign-in/email" } as AuthHookCtx;

// A part that records its name in `ran` and gives `answer` (or throws it) from `before`.
function fakePart(name: string, ran: string[], outcome?: { answer?: unknown; error?: Error }): AuthHookPart {
  return {
    name,
    async before() {
      ran.push(name);
      if (outcome?.error) throw outcome.error;
      return outcome?.answer;
    },
    async after() {
      ran.push(`after:${name}`);
    },
  };
}

describe("runBefore", () => {
  test("a part that answers ends the chain and its answer is returned", async () => {
    const ran: string[] = [];
    const parts = [fakePart("a", ran), fakePart("b", ran, { answer: { answer: 1 } }), fakePart("c", ran)];
    expect(await runBefore(parts, ctx)).toEqual({ answer: 1 });
    expect(ran).toEqual(["a", "b"]);
  });

  test("a part that throws refuses: the error reaches the caller and no later part runs", async () => {
    const ran: string[] = [];
    const refusal = APIError.from("BAD_REQUEST", { code: "REFUSED", message: "No." });
    const parts = [fakePart("a", ran), fakePart("b", ran, { error: refusal }), fakePart("c", ran)];
    await expect(runBefore(parts, ctx)).rejects.toBe(refusal);
    expect(ran).toEqual(["a", "b"]);
  });

  test("parts that return nothing all run in order and the result is undefined", async () => {
    const ran: string[] = [];
    const parts = [fakePart("a", ran), fakePart("b", ran), fakePart("c", ran)];
    expect(await runBefore(parts, ctx)).toBeUndefined();
    expect(ran).toEqual(["a", "b", "c"]);
  });
});

describe("runAfter", () => {
  test("runs every `after` in order and skips a part that has none", async () => {
    const ran: string[] = [];
    const parts = [fakePart("a", ran), { name: "no-after" }, fakePart("c", ran)];
    await runAfter(parts, ctx);
    expect(ran).toEqual(["after:a", "after:c"]);
  });
});

const deps: AuthDeps = {
  databaseUrl: "postgres://ea:ea@127.0.0.1:1/ea",
  baseUrl: "http://localhost:3000",
  secret: "s".repeat(40),
  trustedOrigins: [],
  onEvent: () => Promise.resolve(),
  resetLinkTtlSeconds: 3600,
  onTermsAccepted: () => Promise.resolve(),
};

describe("the assembled auth wiring", () => {
  test("the parts come in the order of the checks", () => {
    const now = () => new Date(0);
    const part: AuthPartContext = {
      deps,
      now,
      report: () => Promise.resolve(),
      resetLimiter: createResetLimiter(now),
      getCodeApi: () => null,
    };
    expect(authHookParts(part).map((each) => each.name)).toEqual([
      "sso-body",
      "reset-limit",
      "reset-terms",
      "pwned-password",
      "revoke-report",
      "lockout",
      "sso-required",
      "two-factor",
    ]);
  });

  test("the plugins come in order: two-factor, the SSO plugins, the sign-in audit last", async () => {
    const handle = createAuth(deps);
    try {
      expect(handle.auth.options.plugins?.map((plugin) => plugin.id)).toEqual([
        "two-factor",
        "sso",
        "ea-sso-audit",
        "ea-sign-in-audit",
      ]);
    } finally {
      await handle.close();
    }
  });
});
