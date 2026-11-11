import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { HardError, SoftError } from "../../platform/errors";

import { HostNotAllowedError, MailAuthError, MailboxExistsError, MailboxNotFoundError } from "./port";
import { mailErrorBody } from "./routes";

describe("mailErrorBody", () => {
  test("maps each error class in order", () => {
    expect(mailErrorBody(new HostNotAllowedError())).toEqual({ status: 400, error: "host_not_allowed" });
    expect(mailErrorBody(new MailboxNotFoundError())).toEqual({ status: 404, error: "not_found" });
    expect(mailErrorBody(new MailboxExistsError())).toEqual({ status: 409, error: "mailbox_exists" });
    expect(mailErrorBody(new MailAuthError("x"))).toEqual({ status: 422, error: "mail_login_failed" });
    expect(mailErrorBody(new SoftError("x"))).toEqual({ status: 502, error: "mail_unreachable" });
    expect(mailErrorBody(new HardError("x"))).toEqual({ status: 502, error: "mail_unreachable" });
  });

  test("returns null for other errors", () => {
    expect(mailErrorBody(new Error("x"))).toBeNull();
    const zodError = z.string().safeParse(1).error;
    expect(mailErrorBody(zodError)).toBeNull();
  });
});
