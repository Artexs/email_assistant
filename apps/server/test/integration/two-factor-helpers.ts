import { randomInt, randomUUID } from "node:crypto";

import { expect } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createAuth, type AuthHandle } from "../../src/platform/auth";
import type { Db } from "../../src/platform/db";
import { auditWebEvent, termsAcceptedHandler } from "../../src/web";
import { secretOfUri, totpCode } from "../totp";

import { resetBody } from "./web-helpers";

export const BASE_URL = "http://127.0.0.1:8080";
export const PASSWORD = "correct-horse-battery-staple";

// A fresh client address per request, so the Better Auth rate limit never answers.
const nextIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

// A trimmed copy of the helpers of web-two-factor.test.ts: a real Better Auth handle, one browser, one enrolled owner.
export function makeTwoFactorKit(db: Db) {
  const resets: { userId: string; url: string }[] = [];
  const handle: AuthHandle = createAuth({
    databaseUrl: process.env.DATABASE_URL ?? "",
    baseUrl: BASE_URL,
    secret: "x".repeat(40),
    trustedOrigins: [BASE_URL],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 86_400,
    now: () => new Date(),
    sendResetPassword: async (input) => {
      resets.push(input);
    },
  });

  // Everything that must never reach a console line: secrets, URIs and codes.
  const secrets: string[] = [];
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const emails: string[] = [];

  class Client {
    readonly jar = new Map<string, string>();

    async call(
      method: "GET" | "POST",
      path: string,
      body?: Record<string, unknown>
    ): Promise<{ status: number; json: Record<string, unknown> | null }> {
      const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await handle.auth.handler(
        new Request(`${BASE_URL}/api/auth${path}`, {
          method,
          headers: {
            origin: BASE_URL,
            "x-client-ip": nextIp(),
            ...(body ? { "content-type": "application/json" } : {}),
            ...(cookie ? { cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
      );
      for (const line of response.headers.getSetCookie()) {
        const [pair = "", ...attributes] = line.split(";");
        const at = pair.indexOf("=");
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        const gone = attributes.some((attribute) => attribute.trim().toLowerCase() === "max-age=0") || value === "";
        if (gone) this.jar.delete(name);
        else this.jar.set(name, value);
      }
      const text = await response.text();
      return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
    }

    post(path: string, body: Record<string, unknown>) {
      return this.call("POST", path, body);
    }

    signIn(email: string) {
      return this.post("/sign-in/email", { email, password: PASSWORD });
    }
  }

  // The code of this moment; the last test checks that no log line holds it.
  function typedCode(secret: string): string {
    const code = totpCode(secret);
    secrets.push(code);
    return code;
  }

  async function createOwner() {
    const email = `reset-${randomUUID()}@x.test`;
    const { orgId, userId } = await createOrganizationWithOwner(db, {
      orgName: "Reset",
      timezone: "Europe/Warsaw",
      email,
      displayName: "Owner",
    });
    orgIds.push(orgId);
    userIds.push(userId);
    emails.push(email);
    resets.length = 0;
    await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE_URL}/setup` } });
    const token = new URL(resets[0]?.url ?? BASE_URL).pathname.split("/").pop() ?? "";
    await handle.auth.api.resetPassword({ body: resetBody(PASSWORD, token) });
    return { email, orgId, userId };
  }

  // Sign in, enable, confirm with the current code.
  async function createEnrolled() {
    const owner = await createOwner();
    const client = new Client();
    expect((await client.signIn(owner.email)).status).toBe(200);
    const enabled = await client.post("/two-factor/enable", { password: PASSWORD });
    expect(enabled.status).toBe(200);
    const uri = String(enabled.json?.totpURI);
    const codes = enabled.json?.backupCodes as string[];
    const secret = secretOfUri(uri);
    secrets.push(secret, uri, ...codes);
    expect((await client.post("/two-factor/verify-totp", { code: typedCode(secret) })).status).toBe(200);
    return { ...owner, client, secret };
  }

  async function cleanup(): Promise<void> {
    if (userIds.length > 0) {
      await sql`DELETE FROM auth_verifications WHERE value IN (${sql.join(userIds)})`.execute(db);
    }
    for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
    if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
    orgIds.length = 0;
    userIds.length = 0;
  }

  return { handle, Client, secrets, emails, typedCode, createOwner, createEnrolled, cleanup };
}
