import { describe, expect, test } from "bun:test";

import { setLocaleForTest, tp } from "./index";
import { en, enPlurals } from "./en";
import { pl, plPlurals } from "./pl";

// The texts of the offline page of the installed panel: the page shows Polish and then English (it has no language of its own).
describe("the offline page texts", () => {
  test("every key is in en and in pl, and the Polish text is the fixed one", () => {
    const keys = ["offline_title", "offline_text", "offline_retry"] as const;
    expect(keys.map((key) => en[key])).toEqual([
      "No connection",
      "The panel needs a network connection to show your data. Check the connection and try again.",
      "Try again",
    ]);
    expect(keys.map((key) => pl[key])).toEqual([
      "Brak połączenia",
      "Panel potrzebuje połączenia z siecią, żeby pokazać Twoje dane. Sprawdź połączenie i spróbuj ponownie.",
      "Spróbuj ponownie",
    ]);
  });
});

// The push device card of Settings: the fixed texts of the stage and the informal "ty" form.
describe("the push device card texts", () => {
  test("the texts that the stage fixes", () => {
    expect([en.push_title, en.push_not_set_up, en.push_blocked, en.push_enable, en.push_test]).toEqual([
      "Phone notices",
      "Phone notices are not set up on this server",
      "Notices are blocked in the browser settings",
      "Turn on notices on this device",
      "Send a test notice",
    ]);
    expect(en.push_install_ios).toBe(
      "Share → Add to Home Screen, then open the app and turn on notices here (iOS 16.4 or later)."
    );
    expect(pl.push_install_ios).toContain("Dodaj do ekranu głównego");
  });

  test("every Polish text is in the informal form: no Pan, Pani or Państwo", () => {
    const polish = Object.entries(pl)
      .filter(([key]) => key.startsWith("push_"))
      .map(([, text]) => text)
      .concat(Object.values(plPlurals.push_test_sent));
    expect(polish.length).toBeGreaterThan(20);
    for (const text of polish) expect(text).not.toMatch(/\b(Pan|Pani|Państw\w*|Pana|Panu)\b/);
  });

  test("the test notice counts devices in both languages", () => {
    expect(Object.keys(enPlurals.push_test_sent)).toEqual(["one", "other"]);
    setLocaleForTest("pl");
    expect([1, 2, 5].map((count) => tp("push_test_sent", count))).toEqual([
      "Wysłano powiadomienie testowe na 1 urządzenie.",
      "Wysłano powiadomienie testowe na 2 urządzenia.",
      "Wysłano powiadomienie testowe na 5 urządzeń.",
    ]);
    setLocaleForTest("en");
    expect(tp("push_test_sent", 2)).toBe("Test notice sent to 2 devices.");
  });
});
