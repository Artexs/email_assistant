import { describe, expect, test } from "bun:test";

import { minimalTexts } from "./minimal";

describe("minimal texts", () => {
  test.each([
    { name: "en no link", locale: "en", url: null, text: "🔎 The review is in the panel." },
    {
      name: "en a link",
      locale: "en",
      url: "https://app.example.test/review",
      text: "🔎 The review is in the panel: https://app.example.test/review",
    },
    { name: "pl no link", locale: "pl", url: null, text: "🔎 Przegląd jest w panelu." },
    {
      name: "pl a link",
      locale: "pl",
      url: "https://app.example.test/review",
      text: "🔎 Przegląd jest w panelu: https://app.example.test/review",
    },
  ] as const)("reviewInPanel: $name", ({ locale, url, text }) => {
    expect(minimalTexts(locale).reviewInPanel(url)).toBe(text);
  });
});
