import { describe, expect, test } from "bun:test";

import { ActionAnchorError, anchorOfRow, emailIdOf } from "./anchor";

const EMAIL = "11111111-1111-4111-8111-111111111111";
const LOOP = "22222222-2222-4222-8222-222222222222";

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof ActionAnchorError ? error.code : "other";
  }
  return undefined;
}

describe("anchorOfRow", () => {
  test("a mail row and a loop row give their anchor", () => {
    expect(anchorOfRow({ email_id: EMAIL, loop_id: null })).toEqual({ kind: "email", emailId: EMAIL });
    expect(anchorOfRow({ email_id: null, loop_id: LOOP })).toEqual({ kind: "loop", loopId: LOOP });
  });

  test("a row with both ids or none breaks the database rule: invalid_anchor", () => {
    expect(codeOf(() => anchorOfRow({ email_id: EMAIL, loop_id: LOOP }))).toBe("invalid_anchor");
    expect(codeOf(() => anchorOfRow({ email_id: null, loop_id: null }))).toBe("invalid_anchor");
  });
});

describe("emailIdOf", () => {
  test("it returns the mail of a mail row", () => {
    expect(emailIdOf({ email_id: EMAIL, loop_id: null })).toBe(EMAIL);
  });

  test("a loop row throws loop_anchor", () => {
    expect(codeOf(() => emailIdOf({ email_id: null, loop_id: LOOP }))).toBe("loop_anchor");
  });

  test("the error carries a code and no row data", () => {
    let error: unknown;
    try {
      emailIdOf({ email_id: null, loop_id: LOOP });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ActionAnchorError);
    expect((error as ActionAnchorError).message).toBe("action anchor: loop_anchor");
    expect((error as ActionAnchorError).message).not.toContain(LOOP);
  });
});
