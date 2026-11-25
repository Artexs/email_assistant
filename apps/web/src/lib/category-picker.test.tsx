/// <reference types="bun" />
import { labelCategories } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CategoryChoices } from "../components/activity/CategoryPicker";
import { setLocaleForTest, t } from "../i18n";

afterEach(() => setLocaleForTest("en"));

describe("CategoryChoices", () => {
  test.each(["en", "pl"] as const)("%s: one button per label category; only the AI's category says so", (locale) => {
    setLocaleForTest(locale);
    const html = renderToStaticMarkup(<CategoryChoices aiCategory="info" onPick={() => undefined} />);
    expect(labelCategories).toHaveLength(5);
    expect(html.match(/<button /g)).toHaveLength(5);
    expect([...html.matchAll(/data-category="([a-z_]+)"/g)].map((m) => m[1])).toEqual([...labelCategories]);
    expect(html.split(t("act_pick_ai"))).toHaveLength(2);
    expect(html).toMatch(new RegExp(`data-category="info".*?${t("act_pick_ai")}`));
  });
});
