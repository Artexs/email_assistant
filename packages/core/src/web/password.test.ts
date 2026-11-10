import { describe, expect, test } from "bun:test";

import { fieldErrors, loginFormSchema, passwordSchema, setPasswordFormSchema } from "./password";

describe("passwordSchema", () => {
  test("refuses 11 characters", () => {
    const result = passwordSchema.safeParse("a".repeat(11));
    expect(result.success ? "" : result.error.issues[0]?.message).toBe("password_too_short");
  });

  test("refuses 129 characters", () => {
    const result = passwordSchema.safeParse("a".repeat(129));
    expect(result.success ? "" : result.error.issues[0]?.message).toBe("password_too_long");
  });

  test("accepts 12 and 128 characters", () => {
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(128)).success).toBe(true);
  });
});

describe("form schemas", () => {
  const password = "correct horse battery";

  test("setPasswordFormSchema reports differing passwords on repeat", () => {
    const result = setPasswordFormSchema.safeParse({ email: "a@b.com", password, repeat: "other" });
    expect(fieldErrors(result)).toEqual({ repeat: "passwords_differ" });
  });

  test("setPasswordFormSchema reports a bad e-mail", () => {
    const result = setPasswordFormSchema.safeParse({ email: "nope", password, repeat: password });
    expect(fieldErrors(result)).toEqual({ email: "email_invalid" });
  });

  test("loginFormSchema reports an empty password", () => {
    const result = loginFormSchema.safeParse({ email: "a@b.com", password: "" });
    expect(fieldErrors(result)).toEqual({ password: "password_required" });
  });

  test("fieldErrors returns nothing on success", () => {
    expect(fieldErrors(loginFormSchema.safeParse({ email: "a@b.com", password: "x" }))).toEqual({});
  });
});
