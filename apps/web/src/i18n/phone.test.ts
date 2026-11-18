import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { pl } from "./pl";

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
