import { describe, expect, test } from "bun:test";

import { textTables } from "./index";

describe("loop tap texts", () => {
  test.each([
    { locale: "en", url: null, text: "More delegates in the panel" },
    {
      locale: "en",
      url: "https://app.example.test/delegates",
      text: "More delegates in the panel: https://app.example.test/delegates",
    },
    { locale: "pl", url: null, text: "Więcej osób w panelu" },
    {
      locale: "pl",
      url: "https://app.example.test/delegates",
      text: "Więcej osób w panelu: https://app.example.test/delegates",
    },
  ] as const)("the delegate picker more line in $locale with url $url", ({ locale, url, text }) => {
    expect(textTables[locale].loopTaps.delegate.more(url)).toBe(text);
  });
});
