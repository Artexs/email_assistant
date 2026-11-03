import { describe, expect, test } from "bun:test";

import { HardError, SoftError } from "../../../platform/errors";
import { MailAuthError } from "../port";

import { imapFlowOptions, isLoopbackHost, toMailError } from "./client";

const creds = { user: "me@interia.pl", password: "pw-secret-1" };

describe("isLoopbackHost", () => {
  test("knows the loopback names", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("poczta.interia.pl")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.example.test")).toBe(false);
  });
});

describe("imapFlowOptions", () => {
  test("a remote host gets TLS on, no tls key and no doSTARTTLS", () => {
    const options = imapFlowOptions({ host: "poczta.interia.pl", port: 993, ...creds });
    expect(options.secure).toBe(true);
    expect("tls" in options).toBe(false);
    expect("doSTARTTLS" in options).toBe(false);
    expect(options).toMatchObject({
      host: "poczta.interia.pl",
      port: 993,
      auth: { user: creds.user, pass: creds.password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 30_000,
    });
  });

  test("a loopback host gets plain IMAP with doSTARTTLS false", () => {
    const options = imapFlowOptions({ host: "127.0.0.1", port: 3143, ...creds });
    expect(options.secure).toBe(false);
    expect(options.doSTARTTLS).toBe(false);
    expect("tls" in options).toBe(false);
  });

  test("a loopback host with secure true keeps TLS on", () => {
    const options = imapFlowOptions({ host: "127.0.0.1", port: 3993, secure: true, ...creds });
    expect(options.secure).toBe(true);
    expect("doSTARTTLS" in options).toBe(false);
  });

  test("secure false with a remote host throws HardError", () => {
    expect(() => imapFlowOptions({ host: "poczta.interia.pl", port: 143, secure: false, ...creds })).toThrow(
      new HardError("plain IMAP is allowed only to a loopback host")
    );
  });

  test("connectionTimeoutMs is passed on", () => {
    const options = imapFlowOptions({ host: "poczta.interia.pl", port: 993, connectionTimeoutMs: 5_000, ...creds });
    expect(options.connectionTimeout).toBe(5_000);
  });
});

describe("toMailError", () => {
  test("an authentication failure gives MailAuthError without the password", () => {
    const original = Object.assign(new Error(`Authentication failed for ${creds.password}`), {
      authenticationFailed: true,
    });
    const error = toMailError(original, "login");
    expect(error).toBeInstanceOf(MailAuthError);
    expect(error.message).not.toContain(creds.password);
    expect(error.cause).toBe(original);
  });

  test("connection codes give SoftError", () => {
    for (const code of ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "NoConnection", "ETIMEOUT"]) {
      const original = Object.assign(new Error("x"), { code });
      const error = toMailError(original, "fetch");
      expect(error).toBeInstanceOf(SoftError);
      expect(error.cause).toBe(original);
    }
  });

  test("other errors give HardError", () => {
    const original = Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    const error = toMailError(original, "connect");
    expect(error).toBeInstanceOf(HardError);
    expect(error).not.toBeInstanceOf(MailAuthError);
    expect(error.cause).toBe(original);
    expect(toMailError("text", "connect")).toBeInstanceOf(HardError);
  });

  test("typed errors pass through", () => {
    const soft = new SoftError("x");
    expect(toMailError(soft, "fetch")).toBe(soft);
  });
});
