/// <reference types="bun" />
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocaleForTest, t } from "../i18n";

// The login page is rendered as the server renders it: no effects run, so `initialOptions` stands for a read that said `{ sso: true }`
// and the address bar is a stub. `SsoSignIn` is wrapped to record the `next` that the page gives it.
const seenNext: string[] = [];
let LoginPage: ComponentType<{ initialOptions?: { sso: boolean } | null }>;
const realLocation = Object.getOwnPropertyDescriptor(globalThis, "location");

function setSearch(search: string) {
  Object.defineProperty(globalThis, "location", {
    value: { search, origin: "https://app.x.test" },
    configurable: true,
  });
}

beforeAll(async () => {
  const real = await import("../components/login/SsoSignIn");
  // Copy the functions first: a module namespace is live, and after `mock.module` it would point to the wrapper itself.
  const { SsoSignIn, SsoView } = real;
  mock.module("../components/login/SsoSignIn", () => ({
    SsoView,
    SsoSignIn: (props: { next: string }) => {
      seenNext.push(props.next);
      return SsoSignIn(props);
    },
  }));
  LoginPage = (await import("../islands/LoginPage")).default;
});

afterEach(() => {
  seenNext.length = 0;
  setLocaleForTest("en");
  if (realLocation) Object.defineProperty(globalThis, "location", realLocation);
  else Reflect.deleteProperty(globalThis, "location");
});

describe("LoginPage with { sso: true }", () => {
  test("a hostile ?next= reaches the company sign-in as /", () => {
    for (const next of [
      "//evil.test",
      "https://evil.test",
      "https://evil.test/x",
      "/\\evil.test",
      "javascript:alert(1)",
    ]) {
      seenNext.length = 0;
      setSearch(`?next=${encodeURIComponent(next)}`);
      const html = renderToStaticMarkup(<LoginPage initialOptions={{ sso: true }} />);
      expect(html).toContain('data-block="sso"');
      expect([next, seenNext]).toEqual([next, ["/"]]);
    }
  });

  test("a same-origin ?next= stays, and no ?next= gives /", () => {
    setSearch("?next=%2Factivity");
    renderToStaticMarkup(<LoginPage initialOptions={{ sso: true }} />);
    setSearch("");
    renderToStaticMarkup(<LoginPage initialOptions={{ sso: true }} />);
    expect(seenNext).toEqual(["/activity", "/"]);
  });

  test("with { sso: false } or no read the block is not rendered", () => {
    setSearch("");
    for (const options of [{ sso: false }, null]) {
      const html = renderToStaticMarkup(<LoginPage initialOptions={options} />);
      expect(html).not.toContain('data-block="sso"');
    }
    expect(seenNext).toEqual([]);
  });
});

describe("LoginPage after a failed return from the callback", () => {
  const hostile = "<img src=x onerror=alert(1)>Ala ma kota";

  test("a hostile error value shows only the fixed generic text, in both languages", () => {
    for (const locale of ["en", "pl"] as const) {
      setLocaleForTest(locale);
      setSearch(
        `?sso=failed&error=${encodeURIComponent(hostile)}&error_description=${encodeURIComponent("Secret text")}`
      );
      const html = renderToStaticMarkup(<LoginPage />);
      expect(html).toContain(t("login_sso_error_generic"));
      expect(html).not.toContain("Ala ma kota");
      expect(html).not.toContain("onerror");
      expect(html).not.toContain("Secret text");
    }
  });

  test("a known code shows its own fixed text", () => {
    setSearch("?sso=failed&error=not_a_member");
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain(t("login_sso_error_not_member"));
    expect(html).not.toContain("not_a_member");
  });

  test("an address without the keys shows no company error", () => {
    setSearch("?next=%2Factivity");
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).not.toContain("login_sso_error");
    expect(html).not.toContain(t("login_sso_error_generic"));
  });
});
