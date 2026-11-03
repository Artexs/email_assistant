import { describe, expect, test } from "bun:test";

import { HardError, SoftError } from "../../../platform/errors";
import { MailAuthError } from "../port";

import { smtpTransportOptions, toSmtpError } from "./smtp";

const creds = { user: "me@interia.pl", password: "pw-secret-1" };

describe("smtpTransportOptions", () => {
  test("a remote host gets TLS on and no tls key", () => {
    const options = smtpTransportOptions({ host: "poczta.interia.pl", port: 465, ...creds });
    expect(options.secure).toBe(true);
    expect("tls" in options).toBe(false);
    expect("ignoreTLS" in options).toBe(false);
    expect(options).toMatchObject({
      host: "poczta.interia.pl",
      port: 465,
      auth: { user: creds.user, pass: creds.password },
    });
  });

  test("a loopback host gets plain SMTP with ignoreTLS", () => {
    const options = smtpTransportOptions({ host: "127.0.0.1", port: 3025, ...creds });
    expect(options.secure).toBe(false);
    expect(options.ignoreTLS).toBe(true);
    expect("tls" in options).toBe(false);
  });

  test("a loopback host with secure true keeps TLS on", () => {
    const options = smtpTransportOptions({ host: "localhost", port: 3465, secure: true, ...creds });
    expect(options.secure).toBe(true);
    expect("ignoreTLS" in options).toBe(false);
  });

  test("secure false with a remote host throws HardError", () => {
    expect(() => smtpTransportOptions({ host: "poczta.interia.pl", port: 587, secure: false, ...creds })).toThrow(
      new HardError("plain SMTP is allowed only to a loopback host")
    );
  });
});

describe("toSmtpError", () => {
  test("EAUTH gives MailAuthError without the password", () => {
    const original = Object.assign(new Error(`Invalid login for ${creds.password}`), { code: "EAUTH" });
    const error = toSmtpError(original);
    expect(error).toBeInstanceOf(MailAuthError);
    expect(error.message).not.toContain(creds.password);
    expect(error.cause).toBe(original);
  });

  test("connection errors give SoftError", () => {
    const cases = [
      { code: "ECONNECTION" },
      { code: "ETIMEDOUT" },
      { code: "EDNS", originalCode: "ENOTFOUND" },
      { code: "ESOCKET", originalCode: "ECONNREFUSED" },
      { code: "ESOCKET", originalCode: "ECONNRESET" },
      { code: "ESOCKET", originalCode: "EPIPE" },
    ];
    for (const fields of cases) {
      const original = Object.assign(new Error("x"), fields);
      const error = toSmtpError(original);
      expect(error).toBeInstanceOf(SoftError);
      expect(error.cause).toBe(original);
    }
  });

  test("a certificate error and other errors give HardError", () => {
    const cert = Object.assign(new Error("self-signed certificate"), {
      code: "ESOCKET",
      originalCode: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    const error = toSmtpError(cert);
    expect(error).toBeInstanceOf(HardError);
    expect(error).not.toBeInstanceOf(MailAuthError);
    expect(error.cause).toBe(cert);
    expect(toSmtpError(Object.assign(new Error("x"), { code: "ETLS" }))).toBeInstanceOf(HardError);
    expect(toSmtpError("text")).toBeInstanceOf(HardError);
  });

  test("typed errors pass through", () => {
    const hard = new HardError("x");
    expect(toSmtpError(hard)).toBe(hard);
  });
});
