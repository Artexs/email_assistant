import { describe, expect, test } from "bun:test";

import { docsUrl, PRODUCT_NAME } from "./site";

describe("docsUrl", () => {
  test("T1 English home", () => {
    expect(docsUrl("/", "en")).toBe("https://artexs.github.io/email_assistant/");
  });

  test("T2 Polish home", () => {
    expect(docsUrl("/", "pl")).toBe("https://artexs.github.io/email_assistant/pl/");
  });

  test("T3 English page", () => {
    expect(docsUrl("/start/", "en")).toBe("https://artexs.github.io/email_assistant/start/");
  });

  test("Polish page", () => {
    expect(docsUrl("/start/", "pl")).toBe("https://artexs.github.io/email_assistant/pl/start/");
  });

  test("T4 a path without a leading slash throws", () => {
    expect(() => docsUrl("start", "en")).toThrow();
  });

  test("the product name", () => {
    expect(PRODUCT_NAME).toBe("Email Assistant");
  });
});
