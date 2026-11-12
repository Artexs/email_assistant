import { describe, expect, test } from "bun:test";
import { connectMailboxBodySchema } from "@ea/core/web";

import {
  fieldErrorKeys,
  initialConnectForm,
  onAddressChange,
  onProviderChange,
  onSmtpSecurityChange,
  toConnectBody,
  type ConnectFormState,
} from "./connect-form";

const other = (patch: Partial<ConnectFormState>): ConnectFormState => ({
  ...onProviderChange(initialConnectForm(), "other"),
  address: "a@example.com",
  password: "pw",
  imapHost: "imap.example.com",
  smtpHost: "smtp.example.com",
  ...patch,
});

describe("connect form", () => {
  test("the initial state", () => {
    expect(initialConnectForm()).toEqual({
      provider: "interia",
      providerTouched: false,
      address: "",
      password: "",
      appPassword: false,
      imapHost: "",
      imapPort: "993",
      smtpHost: "",
      smtpPort: "465",
      smtpSecurity: "tls",
    });
  });

  test("typing an address picks the provider while untouched", () => {
    const gmail = onAddressChange(initialConnectForm(), "anna@gmail.com");
    expect(gmail.provider).toBe("gmail");
    expect(gmail.appPassword).toBe(true);
    const wp = onAddressChange(gmail, "x@wp.pl");
    expect(wp.provider).toBe("wp");
    expect(wp.appPassword).toBe(false);
  });

  test("an address with no preset keeps the app-password switch", () => {
    const on = { ...onAddressChange(initialConnectForm(), "a@exa"), appPassword: true };
    const next = onAddressChange(on, "a@exam");
    expect(next.appPassword).toBe(true);
    expect(next.provider).toBe("interia");
  });

  test("a picked provider is never changed by typing", () => {
    const picked = onProviderChange(initialConnectForm(), "onet");
    expect(onAddressChange(picked, "x@gmail.com").provider).toBe("onet");
  });

  test("the body of a preset has no host keys and keeps the password as typed", () => {
    const state = { ...onAddressChange(initialConnectForm(), " anna@gmail.com "), password: " pw " };
    const body = toConnectBody(state) as Record<string, unknown>;
    expect(body).toEqual({ address: "anna@gmail.com", password: " pw ", secretKind: "app_password", preset: "gmail" });
    expect(connectMailboxBodySchema.safeParse(body).success).toBe(true);
  });

  test("the body of other has numeric ports", () => {
    const body = toConnectBody(other({ imapPort: "3143", smtpPort: "3025" }));
    expect(body).toMatchObject({ imapPort: 3143, smtpPort: 3025, imapHost: "imap.example.com" });
    expect(connectMailboxBodySchema.safeParse(body).success).toBe(true);
  });

  test("the iCloud address picks the iCloud preset with an app password", () => {
    const state = onAddressChange(initialConnectForm(), "anna@icloud.com");
    expect(state.provider).toBe("icloud");
    expect(state.appPassword).toBe(true);
    expect(toConnectBody(state)).toMatchObject({ preset: "icloud" });
  });

  test("the SMTP mode goes into the body of other; a default port follows the mode, a custom port stays", () => {
    const starttls = onSmtpSecurityChange(other({}), "starttls");
    expect(starttls).toMatchObject({ smtpSecurity: "starttls", smtpPort: "587" });
    const body = toConnectBody(starttls);
    expect(body).toMatchObject({ smtpPort: 587, smtpSecurity: "starttls" });
    expect(connectMailboxBodySchema.safeParse(body).success).toBe(true);
    expect(onSmtpSecurityChange(starttls, "tls").smtpPort).toBe("465");
    expect(onSmtpSecurityChange(other({ smtpPort: "2525" }), "starttls").smtpPort).toBe("2525");
  });

  test("the body of a preset has no SMTP mode", () => {
    expect("smtpSecurity" in (toConnectBody(onProviderChange(initialConnectForm(), "icloud")) as object)).toBe(false);
  });

  test("an empty SMTP port gives err_port", () => {
    const result = connectMailboxBodySchema.safeParse(toConnectBody(other({ smtpPort: "" })));
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrorKeys(result.error.issues).smtpPort).toBe("err_port");
  });

  test("a port out of range gives err_port", () => {
    expect(fieldErrorKeys([{ path: ["imapPort"], code: "too_small", message: "x" }]).imapPort).toBe("err_port");
    expect(fieldErrorKeys([{ path: ["smtpPort"], code: "too_big", message: "x" }]).smtpPort).toBe("err_port");
  });

  test("a host with a space gives err_host", () => {
    const result = connectMailboxBodySchema.safeParse(toConnectBody(other({ imapHost: "bad host" })));
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrorKeys(result.error.issues).imapHost).toBe("err_host");
  });

  test("empty fields give required, address and password errors", () => {
    const result = connectMailboxBodySchema.safeParse(toConnectBody(initialConnectForm()));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorKeys(result.error.issues)).toEqual({ address: "email_invalid", password: "err_required" });
    }
  });

  test("server details map by their dotted path", () => {
    expect(fieldErrorKeys([{ path: "imapPort", code: "invalid_type", message: "x" }])).toEqual({
      imapPort: "err_port",
    });
  });
});
