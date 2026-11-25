/// <reference types="bun" />
import { APPROVAL_LIST_MAX } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";

import { setLocaleForTest } from "../i18n";
import { approvalsLeadText } from "./approvals-lead";

afterEach(() => setLocaleForTest("en"));

const waiting = (count: number) => Array.from({ length: count }, () => ({ state: "waiting" as const }));

describe("the lead of the approvals page", () => {
  test.each([
    { locale: "en", count: 1, text: "1 draft waits for you" },
    { locale: "en", count: 5, text: "5 drafts wait for you" },
    { locale: "en", count: APPROVAL_LIST_MAX, text: "100 or more drafts wait for you" },
    { locale: "pl", count: 2, text: "2 szkice czekają na Ciebie" },
    { locale: "pl", count: 5, text: "5 szkiców czeka na Ciebie" },
    { locale: "pl", count: APPROVAL_LIST_MAX, text: "100 lub więcej szkiców czeka na Ciebie" },
  ] as const)("$locale with $count waiting reads $text", ({ locale, count, text }) => {
    setLocaleForTest(locale);
    expect(approvalsLeadText(waiting(count))).toBe(text);
  });

  test("no waiting draft says so; a held send does not count", () => {
    expect(approvalsLeadText([])).toBe("Nothing waits for you");
    expect(approvalsLeadText([{ state: "held" }])).toBe("Nothing waits for you");
    expect(approvalsLeadText([{ state: "held" }, { state: "waiting" }])).toBe("1 draft waits for you");
  });
});
