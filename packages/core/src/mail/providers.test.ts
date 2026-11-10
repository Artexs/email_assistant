import { describe, expect, test } from "bun:test";

import { MAIL_PRESETS, presetForAddress, presetKeys, serversFor } from "./providers";

describe("MAIL_PRESETS", () => {
  test("every key has a row with ports 993 and 465", () => {
    for (const key of presetKeys) {
      expect(MAIL_PRESETS[key].imapPort).toBe(993);
      expect(MAIL_PRESETS[key].smtpPort).toBe(465);
    }
  });
});

describe("presetForAddress", () => {
  test("finds the provider of an address", () => {
    expect(presetForAddress("Anna@Gmail.COM")).toBe("gmail");
    expect(presetForAddress("x@interia.pl")).toBe("interia");
    expect(presetForAddress("x@onet.pl")).toBe("onet");
    expect(presetForAddress("x@wp.pl")).toBe("wp");
    expect(presetForAddress("x@o2.pl")).toBe("o2");
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
    });
  });

  test("returns the given fields without a preset", () => {
    const fields = { imapHost: "127.0.0.1", imapPort: 3143, smtpHost: "127.0.0.1", smtpPort: 3025 };
    expect(serversFor(fields)).toEqual(fields);
  });

  test("throws when a field is missing", () => {
    expect(() => serversFor({ imapHost: "h", imapPort: 1 })).toThrow("server fields missing");
  });
});
