import { describe, expect, test } from "bun:test";

import { renderTemplate } from "./templates";

const fields = {
  task: "Zrób X",
  question: "Które biuro?",
  dueDate: "2026-11-10",
  senderLabel: "a@x.pl",
  dateLabel: "Fri 6 Nov 10:00",
  signature: "Artek",
};

describe("renderTemplate", () => {
  test("renders every kind in both languages", () => {
    expect(renderTemplate("delegation", "pl", fields)).toBe(
      "Dzień dobry,\n\nprzekazuję do realizacji: Zrób X\nTermin: 2026-11-10\nOryginalna wiadomość od a@x.pl z Fri 6 Nov 10:00 jest poniżej.\n\nArtek"
    );
    expect(renderTemplate("delegation", "en", fields)).toBe(
      "Hello,\n\nplease take care of this: Zrób X\nDue: 2026-11-10\nThe original message from a@x.pl of Fri 6 Nov 10:00 is below.\n\nArtek"
    );
    expect(renderTemplate("clarification", "pl", fields)).toBe(
      "Dzień dobry,\n\ndziękuję za wiadomość. Zanim przekażę sprawę dalej, potrzebuję jeszcze jednej informacji: Które biuro?\n\nArtek"
    );
    expect(renderTemplate("clarification", "en", fields)).toBe(
      "Hello,\n\nthank you for your message. Before I can hand it on, I need one more thing: Które biuro?\n\nArtek"
    );
    expect(renderTemplate("reminder", "pl", fields)).toBe(
      "Dzień dobry,\n\nprzypominam o zadaniu: Zrób X\nTermin minął: 2026-11-10.\nProszę o krótką informację o stanie prac.\n\nArtek"
    );
    expect(renderTemplate("reminder", "en", fields)).toBe(
      "Hello,\n\na reminder about this task: Zrób X\nThe due date 2026-11-10 has passed.\nPlease send a short status.\n\nArtek"
    );
  });

  test("leaves the due line out when there is no due date", () => {
    const none = { ...fields, dueDate: null };
    for (const language of ["pl", "en"] as const) {
      for (const kind of ["delegation", "reminder"] as const) {
        const text = renderTemplate(kind, language, none);
        expect(text).not.toContain("2026");
        expect(text).not.toMatch(/Termin|Due|due date/);
      }
    }
  });
});
