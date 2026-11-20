import { describe, expect, test } from "bun:test";

import { docsUrl, PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH, PRODUCT_NAME } from "./site";

describe("docsUrl", () => {
  test.each<[string, string, "en" | "pl", string]>([
    ["T1 English home", "/", "en", "https://artexs.github.io/email_assistant/"],
    ["T2 Polish home", "/", "pl", "https://artexs.github.io/email_assistant/pl/"],
    ["T3 English page", "/start/", "en", "https://artexs.github.io/email_assistant/start/"],
    ["Polish page", "/start/", "pl", "https://artexs.github.io/email_assistant/pl/start/"],
    [
      "a segment that only holds dots inside a name is not a .. segment",
      "/a..b/",
      "en",
      "https://artexs.github.io/email_assistant/a..b/",
    ],
  ])("%s", (_name, path, locale, url) => {
    expect(docsUrl(path, locale)).toBe(url);
  });

  test("T4 a path without a leading slash throws", () => {
    expect(() => docsUrl("start", "en")).toThrow("must start with");
    expect(() => docsUrl("start/", "en")).toThrow("must start with");
    expect(() => docsUrl("", "pl")).toThrow("must start with");
  });

  test("a page path without a trailing slash throws", () => {
    expect(() => docsUrl("/start", "en")).toThrow("must end with");
    expect(() => docsUrl("/how-to/approve", "pl")).toThrow("must end with");
  });

  test("a file path with an extension needs no trailing slash", () => {
    expect(docsUrl("/pagefind/pagefind.js", "en")).toBe(
      "https://artexs.github.io/email_assistant/pagefind/pagefind.js"
    );
    expect(docsUrl("/sitemap-index.xml", "pl")).toBe("https://artexs.github.io/email_assistant/pl/sitemap-index.xml");
  });

  test("a query or an anchor after a page path stays", () => {
    expect(docsUrl("/start/#install", "en")).toBe("https://artexs.github.io/email_assistant/start/#install");
    expect(docsUrl("/start/?q=1", "pl")).toBe("https://artexs.github.io/email_assistant/pl/start/?q=1");
    expect(() => docsUrl("/start#install", "en")).toThrow("must end with");
  });

  test("a path with a .. segment throws", () => {
    expect(() => docsUrl("/../x/", "en")).toThrow("..");
    expect(() => docsUrl("/start/../x/", "pl")).toThrow("..");
    expect(() => docsUrl("/start/..", "en")).toThrow("..");
  });

  test("a pl path that holds the /pl prefix throws; an en path may name the Polish page", () => {
    expect(() => docsUrl("/pl/start/", "pl")).toThrow("/pl");
    expect(() => docsUrl("/pl/", "pl")).toThrow("/pl");
    expect(docsUrl("/pl/start/", "en")).toBe("https://artexs.github.io/email_assistant/pl/start/");
    expect(docsUrl("/plan/", "pl")).toBe("https://artexs.github.io/email_assistant/pl/plan/");
  });

  test("the product name", () => {
    expect(PRODUCT_NAME).toBe("Email Assistant");
  });
});

describe("placeholder price", () => {
  test("the placeholder price is 25 dollars per mailbox per month", () => {
    expect(PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH).toBe(25);
  });
});
