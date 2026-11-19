/// <reference types="bun" />
import type { SuggestionItem } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SuggestionRows } from "../components/rules/SuggestionsCard";
import { setLocaleForTest, t } from "../i18n";

import { ApiError } from "./api";
import {
  acceptOutcome,
  dismissOutcome,
  reasonLines,
  suggestionActionPath,
  suggestionsGone,
  suggestionsPath,
} from "./suggestions-view";

afterEach(() => setLocaleForTest("en"));

const item = (over: Partial<SuggestionItem> & Pick<SuggestionItem, "kind" | "reason">): SuggestionItem => ({
  id: "6f1b6f0e-0000-4000-8000-000000000001",
  scope: "address",
  pattern: "anna@acme.pl",
  createdAt: "2026-11-18T10:00:00.000Z",
  ...over,
});
const textOf = (suggestion: SuggestionItem): string =>
  reasonLines(suggestion)
    .map((line) => t(line.key, line.vars))
    .join(" ");

describe("reason text", () => {
  test("1 a VIP row of answers gives the answers text with both counts", () => {
    expect(textOf(item({ kind: "vip", reason: { received: 8, answered: 6 } }))).toBe(
      "You answered 6 of 8 mails in 30 days."
    );
  });

  test("2 a VIP row of flags gives the flags text; a row with both gives both lines", () => {
    expect(textOf(item({ kind: "vip", reason: { flagged: 3 } }))).toBe("You flagged 3 mails in 30 days.");
    expect(textOf(item({ kind: "vip", reason: { received: 10, answered: 7, flagged: 4 } }))).toBe(
      "You answered 7 of 10 mails in 30 days. You flagged 4 mails in 30 days."
    );
  });

  test("3 a domain blocklist row names the number of senders; an address row does not", () => {
    expect(
      textOf(item({ kind: "blocklist", scope: "domain", pattern: "@acme.pl", reason: { corrected: 4, senders: 2 } }))
    ).toBe("You marked 4 mails as spam in 90 days, from 2 senders of this domain, and never wrote to any of them.");
    expect(textOf(item({ kind: "blocklist", reason: { corrected: 3 } }))).toBe(
      "You marked 3 mails as spam in 90 days and never wrote to this sender."
    );
  });

  test("whitelist rows, address and domain", () => {
    expect(textOf(item({ kind: "whitelist", reason: { rescued: 2 } }))).toBe(
      "You moved back or corrected 2 mails from spam or notifications in 90 days."
    );
    expect(
      textOf(item({ kind: "whitelist", scope: "domain", pattern: "@acme.pl", reason: { rescued: 5, senders: 3 } }))
    ).toBe("You moved back or corrected 5 mails from spam or notifications in 90 days, from 3 senders of this domain.");
  });

  test("the Polish texts fill every count", () => {
    setLocaleForTest("pl");
    expect(textOf(item({ kind: "vip", reason: { received: 8, answered: 6 } }))).toBe(
      "Odpowiedziano na 6 z 8 wiadomości w ciągu 30 dni."
    );
    expect(textOf(item({ kind: "vip", reason: { flagged: 3 } }))).toBe("Oznaczono flagą 3 wiadomości w ciągu 30 dni.");
    expect(
      textOf(item({ kind: "blocklist", scope: "domain", pattern: "@acme.pl", reason: { corrected: 4, senders: 2 } }))
    ).toBe(
      "Oznaczono 4 wiadomości jako spam w ciągu 90 dni, od 2 nadawców z tej domeny, i nigdy nie napisano do żadnego z nich."
    );
    expect(textOf(item({ kind: "whitelist", reason: { rescued: 2 } }))).toContain("2 wiadomości");
  });

  test("a row whose reason lacks its count has no line", () => {
    expect(reasonLines(item({ kind: "vip", reason: {} }))).toEqual([]);
    expect(reasonLines(item({ kind: "blocklist", reason: { rescued: 2 } }))).toEqual([]);
  });
});

describe("rows", () => {
  const rows = [
    item({ kind: "vip", reason: { received: 8, answered: 6 } }),
    item({
      id: "6f1b6f0e-0000-4000-8000-000000000002",
      kind: "blocklist",
      pattern: "junk@spam.test",
      reason: { corrected: 3 },
    }),
  ];
  const render = (canTap: boolean) => renderToStaticMarkup(<SuggestionRows items={rows} canTap={canTap} />);

  test("4 a member view has the pattern, the kind and the reason, and no button", () => {
    const html = render(false);
    expect(html).toContain("anna@acme.pl");
    expect(html).toContain("You answered 6 of 8 mails in 30 days.");
    expect(html).toContain("Blocklist");
    expect(html).not.toContain("<button");
  });

  test("an owner view has Accept and Dismiss for each row, named by the pattern", () => {
    const html = render(true);
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Accept the suggestion for junk@spam.test"');
    expect(html).toContain('aria-label="Dismiss the suggestion for anna@acme.pl"');
  });

  test("an empty list says when suggestions appear", () => {
    expect(renderToStaticMarkup(<SuggestionRows items={[]} />)).toContain(t("sg_empty"));
    expect(t("sg_empty")).toBe(
      "No suggestions now. They appear when your mail shows a clear pattern; at most 3 a week."
    );
  });
});

describe("paths and answers", () => {
  const fail = (status: number, code: string) => new ApiError(status, code);

  test("paths", () => {
    expect(suggestionsPath("m 1")).toBe("/api/suggestions/m%201");
    expect(suggestionActionPath("s1", "accept")).toBe("/api/suggestions/s1/accept");
    expect(suggestionActionPath("s1", "dismiss")).toBe("/api/suggestions/s1/dismiss");
  });

  test("5 a 404 on the list hides the card; another error does not", () => {
    expect(suggestionsGone(fail(404, "not_found"))).toBe(true);
    expect(suggestionsGone(fail(500, "internal"))).toBe(false);
    expect(suggestionsGone(new Error("network"))).toBe(false);
    expect(suggestionsGone(null)).toBe(false);
  });

  test("Accept: success adds a rule and reloads both lists", () => {
    expect(acceptOutcome()).toEqual({
      toast: { kind: "success", key: "rule_added_toast" },
      reload: true,
      rulesChanged: true,
    });
  });

  test("Accept: already reloads in silence; rule_limit keeps the row; not_available says the suggestion is no longer valid", () => {
    expect(acceptOutcome(fail(409, "already"))).toEqual({ toast: null, reload: true, rulesChanged: true });
    expect(acceptOutcome(fail(409, "rule_limit"))).toEqual({
      toast: { kind: "error", key: "err_rule_limit" },
      reload: false,
      rulesChanged: false,
    });
    expect(acceptOutcome(fail(409, "not_available"))).toEqual({
      toast: { kind: "error", key: "sg_not_available" },
      reload: true,
      rulesChanged: false,
    });
    expect(t("sg_not_available")).toBe("This suggestion is no longer valid.");
  });

  test("Accept: a missing row and a server error", () => {
    expect(acceptOutcome(fail(404, "not_found"))).toMatchObject({ toast: { key: "err_not_found" }, reload: true });
    expect(acceptOutcome(fail(500, "internal"))).toEqual({
      toast: { kind: "error", key: "error_generic" },
      reload: false,
      rulesChanged: false,
    });
    expect(acceptOutcome(new Error("offline")).toast?.key).toBe("error_generic");
  });

  test("Dismiss: the row leaves with a toast; already is silent; the rule list never reloads", () => {
    expect(dismissOutcome()).toEqual({
      toast: { kind: "success", key: "sg_dismissed_toast" },
      reload: true,
      rulesChanged: false,
    });
    expect(dismissOutcome(fail(409, "already"))).toEqual({ toast: null, reload: true, rulesChanged: false });
    expect(dismissOutcome(fail(404, "not_found"))).toMatchObject({ toast: { key: "err_not_found" }, reload: true });
    expect(dismissOutcome(fail(500, "internal")).reload).toBe(false);
    expect(t("sg_dismissed_toast")).toBe("Hidden for 90 days");
  });
});
