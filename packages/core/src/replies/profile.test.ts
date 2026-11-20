import { describe, expect, test } from "bun:test";

import { checkReplyBody } from "./checks";
import { detectLanguage } from "./language";
import {
  checkProfileInput,
  PROFILE_NAME_MAX,
  PROFILE_SIGNATURE_MAX,
  PROFILE_STYLE_MAX,
  profileFallbacks,
  profileLength,
  resolveReplyStyle,
} from "./profile";
import { SAMPLE_MAIL } from "./sample-mail";

describe("checkProfileInput (F115 stage 10)", () => {
  test("a clean name, signature and style pass; a key that is left out stays out", () => {
    expect(checkProfileInput({ displayName: "Anna Nowak" })).toEqual({
      ok: true,
      fields: { displayName: "Anna Nowak" },
    });
    expect(checkProfileInput({})).toEqual({ ok: true, fields: {} });
    expect(checkProfileInput({ signature: "Pozdrawiam,\nAnna", writingStyle: "Krótko." })).toEqual({
      ok: true,
      fields: { signature: "Pozdrawiam,\nAnna", writingStyle: "Krótko." },
    });
  });

  test("an empty or blank text is null: the fallback applies", () => {
    expect(checkProfileInput({ displayName: "", signature: "  \n ", writingStyle: "\u0007" })).toEqual({
      ok: true,
      fields: { displayName: null, signature: null, writingStyle: null },
    });
  });

  test('a name may not hold < > " @ or a line break, and the answer names the field and a code, never the text', () => {
    for (const displayName of [
      "A <b>",
      "A>",
      'A "B"',
      "a@b",
      "Anna\nBcc: x",
      "Anna\r\nBcc: x",
      "Anna B",
      "Anna\u0085B",
    ]) {
      const result = checkProfileInput({ displayName });
      expect(result).toMatchObject({ ok: false, field: "displayName" });
      expect(JSON.stringify(result)).not.toContain("Bcc");
    }
    expect(checkProfileInput({ displayName: "A <b>" })).toEqual({
      ok: false,
      field: "displayName",
      code: "bad_character",
    });
    expect(checkProfileInput({ displayName: "A\nB" })).toEqual({ ok: false, field: "displayName", code: "line_break" });
  });

  test("a signature and a style may hold several lines and these characters", () => {
    const text = 'Anna <anna@x.test>\n"Quote"';
    expect(checkProfileInput({ signature: text, writingStyle: text })).toEqual({
      ok: true,
      fields: { signature: text, writingStyle: text },
    });
  });

  test("the limits count code points: 100, 1,000, 1,000 pass and one more fails", () => {
    expect(checkProfileInput({ displayName: "n".repeat(PROFILE_NAME_MAX) }).ok).toBe(true);
    expect(checkProfileInput({ signature: "s".repeat(PROFILE_SIGNATURE_MAX) }).ok).toBe(true);
    expect(checkProfileInput({ writingStyle: "😀".repeat(PROFILE_STYLE_MAX) }).ok).toBe(true);
    expect(checkProfileInput({ displayName: "n".repeat(PROFILE_NAME_MAX + 1) })).toEqual({
      ok: false,
      field: "displayName",
      code: "too_long",
    });
    expect(checkProfileInput({ signature: "s".repeat(PROFILE_SIGNATURE_MAX + 1) })).toMatchObject({
      field: "signature",
    });
    expect(checkProfileInput({ writingStyle: "😀".repeat(PROFILE_STYLE_MAX + 1) })).toMatchObject({
      field: "writingStyle",
    });
  });

  test("the length counts the text after the clean-up: control characters do not count", () => {
    expect(checkProfileInput({ writingStyle: `${"w".repeat(PROFILE_STYLE_MAX)}\u0007\u0000` }).ok).toBe(true);
  });

  test("control and bidi characters are cut; a name is one line; a signature keeps its lines", () => {
    expect(checkProfileInput({ displayName: "  Anna \u0007 ‮Nowak " })).toEqual({
      ok: true,
      fields: { displayName: "Anna Nowak" },
    });
    expect(checkProfileInput({ signature: "One \r\nTwo\n\n" })).toEqual({
      ok: true,
      fields: { signature: "One\nTwo" },
    });
  });

  test("the first problem is reported in the order name, signature, style", () => {
    expect(
      checkProfileInput({ writingStyle: "w".repeat(2000), signature: "s".repeat(2000), displayName: "a@b" })
    ).toMatchObject({ field: "displayName" });
    expect(checkProfileInput({ writingStyle: "w".repeat(2000), signature: "s".repeat(2000) })).toMatchObject({
      field: "signature",
    });
  });
});

describe("the fallbacks of the profile", () => {
  test("the name falls back to the owner name, then the address; the signature to the same text", () => {
    expect(profileFallbacks({ ownerName: "Wiktor Szalewski", address: "a@x.test" })).toEqual({
      name: "Wiktor Szalewski",
      signature: "Wiktor Szalewski",
    });
    expect(profileFallbacks({ ownerName: null, address: "a@x.test" })).toEqual({
      name: "a@x.test",
      signature: "a@x.test",
    });
    expect(profileFallbacks({ ownerName: " ", address: "a@x.test" }).signature).toBe("a@x.test");
  });

  test("resolveReplyStyle takes the stored text, else the fallback; the style stays null", () => {
    const fallbacks = { name: "Jan", signature: "Org text" };
    expect(resolveReplyStyle(null, fallbacks)).toEqual({
      displayName: "Jan",
      signature: "Org text",
      writingStyle: null,
    });
    expect(resolveReplyStyle({ displayName: "Anna", signature: "Sig", writingStyle: "Warm" }, fallbacks)).toEqual({
      displayName: "Anna",
      signature: "Sig",
      writingStyle: "Warm",
    });
    expect(resolveReplyStyle({ displayName: " ", signature: null, writingStyle: " " }, fallbacks)).toEqual({
      displayName: "Jan",
      signature: "Org text",
      writingStyle: null,
    });
  });
});

describe("the sample mail of the preview", () => {
  test("one mail for each language, in its language, with no real address", () => {
    for (const language of ["pl", "en"] as const) {
      const mail = SAMPLE_MAIL[language];
      expect(mail.fromAddress.endsWith("@example.com")).toBe(true);
      expect(detectLanguage(mail.body)).toBe(language);
      // A draft that quotes the sample mail passes the checks of the drafter.
      expect(
        checkReplyBody("Dzień dobry", { language: "pl", allowed: [], quoted: [mail.subject, mail.body] })
      ).toMatchObject({ ok: true });
    }
  });
});

describe("profileLength (F115 stage 11)", () => {
  test("it counts code points of the cleaned text, as the check does", () => {
    expect(profileLength("signature", "  Anna \n")).toBe(4);
    expect(profileLength("displayName", "Anna\u0007   Nowak")).toBe(10);
    expect(profileLength("signature", "😀".repeat(3))).toBe(3);
    expect(checkProfileInput({ signature: "ą".repeat(PROFILE_SIGNATURE_MAX) }).ok).toBe(true);
    expect(profileLength("signature", `${"ą".repeat(PROFILE_SIGNATURE_MAX)}  `)).toBe(PROFILE_SIGNATURE_MAX);
  });
});
