/// <reference types="bun" />
import type { MailboxView } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AddRuleForm } from "../components/rules/AddRuleForm";
import { setLocaleForTest, t } from "../i18n";

afterEach(() => setLocaleForTest("en"));

const noop = (): void => undefined;

const markup = (): string =>
  renderToStaticMarkup(<AddRuleForm mailboxes={[] as MailboxView[]} onAdded={noop} onMissingMailbox={noop} />);

// The ids of the three controls in the order of the markup.
const controlOrder = (html: string): string[] =>
  [...html.matchAll(/id="(rule-pattern|rule-kind|rule-scope)"/g)].map((match) => match[1] ?? "");

describe("AddRuleForm sentence", () => {
  test.each([
    ["en", ["rule-pattern", "rule-kind", "rule-scope"]],
    ["pl", ["rule-pattern", "rule-scope", "rule-kind"]],
  ] as const)("the %s controls follow the order of the sentence", (locale, order) => {
    setLocaleForTest(locale);
    expect(controlOrder(markup())).toEqual([...order]);
  });

  test.each(["en", "pl"] as const)("in %s each control has the name of its label key", (locale) => {
    setLocaleForTest(locale);
    const html = markup();
    expect(html).toContain(`id="rule-pattern" aria-label="${t("rules_pattern_label")}"`);
    expect(html).toContain(`id="rule-kind" aria-label="${t("rules_kind_label")}"`);
    expect(html).toContain(`id="rule-scope" aria-label="${t("rules_scope_label")}"`);
  });
});
