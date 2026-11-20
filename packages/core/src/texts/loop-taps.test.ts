import { describe, expect, test } from "bun:test";

import { textTables } from "./index";

describe("loop tap texts", () => {
  test.each([
    { name: "en no link", locale: "en", url: null, text: "More delegates in the panel" },
    {
      name: "en a link",
      locale: "en",
      url: "https://app.example.test/delegates",
      text: "More delegates in the panel: https://app.example.test/delegates",
    },
    { name: "pl no link", locale: "pl", url: null, text: "Więcej osób w panelu" },
    {
      name: "pl a link",
      locale: "pl",
      url: "https://app.example.test/delegates",
      text: "Więcej osób w panelu: https://app.example.test/delegates",
    },
  ] as const)("the delegate picker more line: $name", ({ locale, url, text }) => {
    expect(textTables[locale].loopTaps.delegate.more(url)).toBe(text);
  });
});
