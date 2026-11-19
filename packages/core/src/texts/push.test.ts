import { describe, expect, test } from "bun:test";

import { pushPayloadKinds } from "../notices/push";

import { pushTexts } from "./push";

describe("pushTexts", () => {
  test("3. Polish has a title and a body for every push kind and test; counts 1, 2 and 5 give the three plural forms of urgent", () => {
    const pl = pushTexts("pl");
    expect(pl.body("urgent", 1)).toBe("1 pilna wiadomość");
    expect(pl.body("urgent", 2)).toBe("2 pilne wiadomości");
    expect(pl.body("urgent", 5)).toBe("5 pilnych wiadomości");
    expect(pl.body("urgent", 22)).toBe("22 pilne wiadomości");
    expect(pl.body("urgent", 12)).toBe("12 pilnych wiadomości");
    expect(pl.body("approval", 3)).toBe("3 szkice czekają na Ciebie");
    expect(pl.body("approval", 5)).toBe("5 szkiców czeka na Ciebie");
    // The count of a set is its drafts.
    expect(pl.body("approval_set", 2)).toBe("2 szkice czekają na Ciebie");
    expect(pl.body("host_blocked", 1)).toBe("1 skrzynka ma niedozwolony serwer");
    expect(pl.body("host_blocked", 2)).toBe("2 skrzynki mają niedozwolony serwer");
    expect(pl.body("host_blocked", 5)).toBe("5 skrzynek ma niedozwolony serwer");
    for (const lang of ["pl", "en"] as const) {
      const texts = pushTexts(lang);
      for (const kind of pushPayloadKinds) {
        for (const count of [0, 1, 2, 5, 22]) {
          expect(texts.title(kind).length).toBeGreaterThan(0);
          const body = texts.body(kind, count);
          expect(body.length).toBeGreaterThan(0);
          expect(body).not.toContain("{count}");
          if (kind !== "test") expect(body).toContain(String(count));
        }
      }
    }
  });

  test("English has one and other forms", () => {
    const en = pushTexts("en");
    expect(en.body("urgent", 1)).toBe("1 urgent mail");
    expect(en.body("urgent", 2)).toBe("2 urgent mails");
    expect(en.body("approval", 3)).toBe("3 drafts wait for you");
    expect(en.body("approval_set", 2)).toBe("2 drafts wait for you");
    expect(en.body("test", 7)).toBe("Notices work on this device.");
  });

  test("no title or body holds an address or a link", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const kind of pushPayloadKinds) {
        const text = `${pushTexts(lang).title(kind)} ${pushTexts(lang).body(kind, 3)}`;
        expect(text).not.toMatch(/@|https?:/);
      }
    }
  });
});
