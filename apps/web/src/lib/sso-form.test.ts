import { describe, expect, test } from "bun:test";

import { ssoFormReducer, ssoFormStart, type SsoFormAction, type SsoFormState } from "./sso-form";

function run(actions: SsoFormAction[], from: SsoFormState = ssoFormStart): SsoFormState {
  return actions.reduce(ssoFormReducer, from);
}

describe("ssoFormReducer", () => {
  test("opening the form asks for the focus on the e-mail field", () => {
    const opened = run([{ type: "open" }]);
    expect(opened.open).toBe(true);
    expect(opened.focus).toBe("email");
  });

  test("Back closes the form, clears the error and asks for the focus on the opening button", () => {
    const back = run([{ type: "open" }, { type: "invalid", key: "email_invalid" }, { type: "back" }]);
    expect(back.open).toBe(false);
    expect(back.error).toBeNull();
    expect(back.focus).toBe("button");
  });

  test("two focus requests in a row differ, so the second one moves the focus again", () => {
    const a = run([{ type: "open" }, { type: "back" }]);
    const b = run([{ type: "open" }], a);
    expect(b.focus).toBe("email");
    expect(b.focusSeq).toBeGreaterThan(a.focusSeq);
  });

  test("a start sets pending and clears the error; a failure sets the text and ends pending", () => {
    const running = run([{ type: "open" }, { type: "invalid", key: "email_invalid" }, { type: "start" }]);
    expect(running.pending).toBe(true);
    expect(running.error).toBeNull();
    const failed = run([{ type: "failed", key: "login_sso_error_rate" }], running);
    expect(failed.pending).toBe(false);
    expect(failed.error).toBe("login_sso_error_rate");
  });

  test("a page restored from the browser cache ends a running request", () => {
    const running = run([{ type: "open" }, { type: "start" }]);
    expect(run([{ type: "restored" }], running).pending).toBe(false);
    expect(run([{ type: "restored" }], ssoFormStart)).toBe(ssoFormStart);
  });
});
