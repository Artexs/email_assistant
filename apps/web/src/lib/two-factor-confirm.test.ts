import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { describe, expect, test } from "bun:test";

import { disableWithCode, newCodesWithCode } from "./two-factor-confirm";

// A real Better Auth client whose fetch records the request instead of sending it.
function recordingClient() {
  const sent: { url: string; body: unknown }[] = [];
  const client = createAuthClient({
    baseURL: "http://127.0.0.1:8081",
    plugins: [twoFactorClient()],
    fetchOptions: {
      customFetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(input), body: JSON.parse(String(init?.body ?? "null")) });
        return new Response(JSON.stringify({ status: true, backupCodes: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  return { client, sent };
}

describe("two-factor confirm calls", () => {
  test("turn off sends the password and the code in the body", async () => {
    const { client, sent } = recordingClient();
    await disableWithCode(client.twoFactor, { password: "pw-123456789012", code: "123456" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toContain("/two-factor/disable");
    expect(sent[0]?.body).toEqual({ password: "pw-123456789012", code: "123456" });
  });

  test("new backup codes send the password and the code in the body", async () => {
    const { client, sent } = recordingClient();
    await newCodesWithCode(client.twoFactor, { password: "pw-123456789012", code: "abcde-12345" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toContain("/two-factor/generate-backup-codes");
    expect(sent[0]?.body).toEqual({ password: "pw-123456789012", code: "abcde-12345" });
  });
});
