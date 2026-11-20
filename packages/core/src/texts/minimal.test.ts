import { describe, expect, test } from "bun:test";

import { minimalTexts } from "./minimal";

describe("minimal texts", () => {
  test.each([
    { locale: "en", url: null, text: "🔎 The review is in the panel." },
    {
      locale: "en",
      url: "https://app.example.test/review",
      text: "🔎 The review is in the panel: https://app.example.test/review",
    },
    { locale: "pl", url: null, text: "🔎 Przegląd jest w panelu." },
    {
      locale: "pl",
      url: "https://app.example.test/review",
      text: "🔎 Przegląd jest w panelu: https://app.example.test/review",
    },
  ] as const)("reviewInPanel in $locale with url $url", ({ locale, url, text }) => {
    expect(minimalTexts(locale).reviewInPanel(url)).toBe(text);
  });
});
