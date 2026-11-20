import { describe, expect, test } from "bun:test";

import { textTables } from "./index";

// The error texts of a failed send and the rejected lines: each case pins the whole text of one locale.
describe("approval texts: the cause of a failed send", () => {
  test.each([
    ["en", 1, "", "The send failed 1 time"],
    ["en", 3, "", "The send failed 3 times"],
    ["pl", 1, "", "Wysyłanie nie powiodło się 1 raz"],
    ["pl", 3, "", "Wysyłanie nie powiodło się 3 razy"],
    ["pl", 5, "550", "Wysyłanie nie powiodło się 5 razy (550)"],
  ] as const)("tries (%s): %d times, code %j", (locale, tries, code, expected) => {
    expect(textTables[locale].approvals.causes.tries(tries, code)).toBe(expected);
  });

  test.each([
    [
      "en",
      "",
      "The mail server refused the content for now (code unknown); the system never retries after the content",
    ],
    ["pl", "", "Serwer poczty chwilowo odrzucił treść (kod: nieznany); system nie ponawia próby po wysłaniu treści"],
    ["pl", "552", "Serwer poczty chwilowo odrzucił treść (kod: 552); system nie ponawia próby po wysłaniu treści"],
  ] as const)("contentSoft (%s): code %j", (locale, code, expected) => {
    expect(textTables[locale].approvals.causes.contentSoft(code)).toBe(expected);
  });

  test.each([
    ["en", "", "The mail server did not accept the mail for 6 hours; nothing was sent"],
    ["pl", "452", "Serwer poczty nie przyjął wiadomości przez 6 godzin (452); nic nie wysłano"],
    ["pl", "", "Serwer poczty nie przyjął wiadomości przez 6 godzin; nic nie wysłano"],
  ] as const)("softCap (%s): code %j", (locale, code, expected) => {
    expect(textTables[locale].approvals.causes.softCap(code)).toBe(expected);
  });
});

describe("approval texts: the rejected lines", () => {
  test.each([
    ["en", "Anna", "✖️ Follow-up rejected (Anna)"],
    ["pl", null, "✖️ Przypomnienie o odpowiedzi odrzucone"],
  ] as const)("a rejected follow-up (%s): name %j", (locale, name, expected) => {
    expect(textTables[locale].approvals.followUp.rejected(name)).toBe(expected);
  });

  test.each([["pl", null, "✖️ Odrzucono · Faktura"]] as const)(
    "a rejected send result (%s): name %j",
    (locale, name, expected) => {
      expect(textTables[locale].approvals.sendResult.rejected(name, "Faktura")).toBe(expected);
    }
  );
});
