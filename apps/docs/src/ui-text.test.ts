import { describe, expect, test } from "bun:test";
import { en } from "@ea/web/i18n/en";
import { pl } from "@ea/web/i18n/pl";

import { uiText } from "./ui-text";

describe("uiText", () => {
  test("T8 `nav_settings` is `Settings` in en and the pl.ts value in pl; the root locale reads en", () => {
    expect(uiText("nav_settings", "en")).toBe("Settings");
    expect(uiText("nav_settings", "root")).toBe("Settings");
    expect(uiText("nav_settings", undefined)).toBe("Settings");
    expect(uiText("nav_settings", "pl")).toBe(pl.nav_settings);
    expect(pl.nav_settings).not.toBe("Settings");
  });
  test("T9 a text with a {var} placeholder throws, in either language", () => {
    expect(() => uiText("trial_ends_on", "en")).toThrow("ui_text_has_vars trial_ends_on");
    expect(() => uiText("trial_ends_on", "pl")).toThrow("ui_text_has_vars trial_ends_on");
  });
  test("T10 an unknown key throws, also one that exists only on Object.prototype", () => {
    expect(() => uiText("no_such_key", "en")).toThrow("ui_text_unknown no_such_key");
    expect(() => uiText("toString", "en")).toThrow("ui_text_unknown toString");
    expect(() => uiText("constructor", "pl")).toThrow("ui_text_unknown constructor");
  });
  test("a key in the panel's exports answers every other plain text", () => {
    expect(uiText("brand", "en")).toBe(en.brand);
    expect(uiText("close", "pl")).toBe(pl.close);
  });
  test("a placeholder in only one language throws; a lone brace is not a placeholder", () => {
    expect(() => uiText("k", "en", { en: { k: "Hi {name}" }, pl: { k: "Cześć" } })).toThrow("ui_text_has_vars k");
    expect(() => uiText("k", "pl", { en: { k: "Hi" }, pl: { k: "Cześć {name}" } })).toThrow("ui_text_has_vars k");
    expect(uiText("k", "pl", { en: { k: "Hi {" }, pl: { k: "Cześć" } })).toBe("Cześć");
  });
});
