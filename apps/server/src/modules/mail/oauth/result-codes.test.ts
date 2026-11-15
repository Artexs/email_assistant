import { mailOAuthResultCodes, type MailOAuthResultCode } from "@ea/core";
import { describe, expect, test } from "bun:test";

import type { OAuthResultCode } from "./apply";

// The panel maps every `?oauth=` code to a text (`apps/web/src/lib/mail-oauth.ts`). A code added here without the panel list, or the reverse, fails `bun run typecheck`.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const sameCodes: Same<OAuthResultCode, MailOAuthResultCode> = true;

describe("OAuth result codes", () => {
  test("the server union and the panel list are equal", () => {
    expect(sameCodes).toBe(true);
    expect(new Set(mailOAuthResultCodes).size).toBe(mailOAuthResultCodes.length);
  });
});
