import { describe, expect, test } from "bun:test";

import { MAIL_PRESETS, presetForAddress, presetKeys, serversFor } from "./providers";

describe("MAIL_PRESETS", () => {
  test("every key has IMAP port 993 and an SMTP port that matches its security mode", () => {
    for (const key of presetKeys) {
      expect(MAIL_PRESETS[key].imapPort).toBe(993);
      expect(MAIL_PRESETS[key].smtpPort).toBe(MAIL_PRESETS[key].smtpSecurity === "tls" ? 465 : 587);
    }
  });

  test("iCloud uses an app password and SMTP on 587 with STARTTLS", () => {
    expect(MAIL_PRESETS.icloud).toEqual({
      imapHost: "imap.mail.me.com",
      imapPort: 993,
      smtpHost: "smtp.mail.me.com",
      smtpPort: 587,
      smtpSecurity: "starttls",
      secretKind: "app_password",
      domains: ["icloud.com", "me.com", "mac.com"],
    });
  });
});

describe("presetForAddress", () => {
  test("finds the provider of an address", () => {
    expect(presetForAddress("Anna@Gmail.COM")).toBe("gmail");
    expect(presetForAddress("x@interia.pl")).toBe("interia");
    expect(presetForAddress("x@onet.pl")).toBe("onet");
    expect(presetForAddress("x@wp.pl")).toBe("wp");
    expect(presetForAddress("x@o2.pl")).toBe("o2");
    expect(presetForAddress("x@icloud.com")).toBe("icloud");
    expect(presetForAddress("x@me.com")).toBe("icloud");
  });

  test("returns null for sub-domains, unknown domains and bad input", () => {
    expect(presetForAddress("x@mail.gmail.com")).toBeNull();
    expect(presetForAddress("x@example.com")).toBeNull();
    expect(presetForAddress("no-at-sign")).toBeNull();
    expect(presetForAddress("x@")).toBeNull();
  });

  test("uses the last @", () => {
    expect(presetForAddress("a@b@gmail.com")).toBe("gmail");
  });
});

describe("serversFor", () => {
  test("returns the preset values", () => {
    expect(serversFor({ preset: "onet" })).toEqual({
      imapHost: "imap.poczta.onet.pl",
      imapPort: 993,
      smtpHost: "smtp.poczta.onet.pl",
      smtpPort: 465,
      smtpSecurity: "tls",
    });
    expect(serversFor({ preset: "icloud" }).smtpSecurity).toBe("starttls");
  });

  test("returns the given fields without a preset; the security defaults to tls", () => {
    const fields = { imapHost: "127.0.0.1", imapPort: 3143, smtpHost: "127.0.0.1", smtpPort: 3025 };
    expect(serversFor(fields)).toEqual({ ...fields, smtpSecurity: "tls" });
    expect(serversFor({ ...fields, smtpSecurity: "starttls" }).smtpSecurity).toBe("starttls");
  });

  test("throws when a field is missing", () => {
    expect(() => serversFor({ imapHost: "h", imapPort: 1 })).toThrow("server fields missing");
  });
});
