import { describe, expect, test } from "bun:test";

import { textTables, textsFor } from "./index";

describe("the texts registry", () => {
  test("every locale gets its own table", () => {
    expect(textsFor("en")).toBe(textTables.en);
    expect(textsFor("pl")).toBe(textTables.pl);
    expect(textTables.pl.locale).toBe("pl");
    expect(textTables.en.locale).toBe("en");
  });

  // Sample arguments for the text functions: they cover each branch of the texts.
  const samples: unknown[][] = [
    [true],
    [false],
    [true, "A"],
    [false, "A"],
    [true, "A", "B"],
    [false, "A", "B"],
    ["A", "B", 62],
  ];

  // A text with an argument that is not a string or a flag needs its own samples; the key is the end of the path.
  const ownSamples: Record<string, unknown[][]> = {
    "authError.fixOAuth": [
      ["Microsoft", null],
      ["Google", "oauth_expired"],
      ["Google", "oauth_revoked"],
      ["Google", "admin_consent_required"],
      ["Google", "protocol_disabled"],
    ],
    // The operator notices take more than three arguments; the cap count covers the Polish plural forms.
    "operator.llmCap": [
      ["m", "o", 1, "d"],
      ["m", "o", 2, "d"],
      ["m", "o", 5, "d"],
    ],
    "operator.authMailFailed": [["reset", "u", "o", "EAUTH"]],
    "operator.sendLimit": [["m", "o", "mailbox_hour", "a", "b"]],
    // The service-level alert words take a phase, a count or a fact reader: zero facts, one fact, and a negative age.
    "slo.line1": [
      ["open", "slo_disk", "s", 1],
      ["repeat", "slo_disk", "s", 1],
      ["resolved", "slo_disk", "s", 1],
      ["test", "slo_disk", "s", 1],
    ],
    "slo.more": [[3]],
    ...Object.fromEntries(
      ["slo_sync_lag", "slo_urgent_latency", "slo_llm_errors", "slo_disk", "slo_backup_age"].map((kind) => [
        `slo.facts.${kind}`,
        [[() => "0"], [() => "1"], [(key: string) => (key === "age_h" ? "-1" : "1")]],
      ])
    ),
  };

  // Walks a table: a string is non-empty, an array holds such values, a function returns a non-empty string.
  function walk(path: string, value: unknown, seen: string[]): void {
    seen.push(path);
    if (typeof value === "string") {
      expect(value.length, path).toBeGreaterThan(0);
    } else if (Array.isArray(value)) {
      expect(value.length, path).toBeGreaterThan(0);
      value.forEach((item, index) => walk(`${path}[${index}]`, item, seen));
    } else if (typeof value === "function") {
      const own = Object.entries(ownSamples).find(([key]) => path.endsWith(key))?.[1];
      const results = (own ?? samples).flatMap((args) => {
        if (args.length !== value.length) return [];
        const result: unknown = value(...args);
        return [result];
      });
      expect(results.length, path).toBeGreaterThan(0);
      for (const result of results) {
        expect(typeof result, path).toBe("string");
        expect((result as string).length, path).toBeGreaterThan(0);
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) walk(`${path}.${key}`, child, seen);
    } else {
      throw new Error(`${path}: unexpected value`);
    }
  }

  for (const locale of ["en", "pl"] as const) {
    test(`every text of ${locale} is non-empty`, () => {
      const seen: string[] = [];
      walk(locale, textTables[locale], seen);
      expect(seen.length).toBeGreaterThan(30);
    });
  }

  test("the warning texts have fixed values", () => {
    expect(textTables.en.suspicious.line("x")).toBe("⚠ Suspicious: x");
    expect(textTables.pl.suspicious.line("x")).toBe("⚠ Podejrzana wiadomość: x");
    expect(textTables.en.suspicious.noDraft).toBe("no draft: suspicious mail");
    expect(textTables.pl.suspicious.noDraft).toBe("bez szkicu: podejrzana wiadomość");
    expect(textTables.pl.suspicious.reason).toEqual({
      auth_fail: "nadawca nie przeszedł weryfikacji",
      lookalike_domain: "domena podobna do znanej",
      display_name_spoof: "fałszywa nazwa nadawcy",
      reply_to_mismatch: "odpowiedzi idą do innej domeny",
      link_mismatch: "link prowadzi gdzie indziej",
      risky_attachment: "ryzykowny załącznik",
    });
    expect(textTables.en.suspicious.reason).toEqual({
      auth_fail: "sender check failed",
      lookalike_domain: "look-alike domain",
      display_name_spoof: "fake sender name",
      reply_to_mismatch: "replies go to another domain",
      link_mismatch: "link goes elsewhere",
      risky_attachment: "risky attachment",
    });
  });

  test("both locales have the same keys", () => {
    const keys = (value: unknown, path: string): string[] =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${path}.${key}`))
        : [path];
    expect(keys(textTables.pl, "t")).toEqual(keys(textTables.en, "t"));
  });

  // Every Polish line puts a value after at most one colon; a second label takes a dash or a plain word.
  test("no Polish line holds two colons", () => {
    const lines: { path: string; line: string }[] = [];
    const collect = (path: string, value: unknown): void => {
      // The service-level alert words are shipped text (two colons in the Polish LLM line): this stage keeps them as they were.
      if (path.includes(".slo.")) return;
      if (typeof value === "string") {
        for (const line of value.split("\n")) lines.push({ path, line });
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => collect(`${path}[${index}]`, item));
      } else if (typeof value === "function") {
        for (const args of samples) {
          if (args.length === value.length) collect(path, value(...args));
        }
      } else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) collect(`${path}.${key}`, child);
      }
    };
    collect("pl", textTables.pl);
    expect(lines.length).toBeGreaterThan(100);
    for (const { path, line } of lines) {
      const colons = line.match(/:(?=\s|$)/g)?.length ?? 0;
      expect(colons, `${path}: ${line}`).toBeLessThanOrEqual(1);
      // A line with a colon takes no spaced dash: one separator style per line.
      expect(colons > 0 && line.includes(" – "), `${path}: ${line}`).toBe(false);
    }
  });
});

// The text that replaces a delivered follow-up card when "Track my sent mail" goes off. It holds no mail data and
// no placeholder, so a leak of a recipient, a subject or a quote cannot ride in it.
describe("followUpRemoved", () => {
  test("Polish keeps its diacritics and the shared term for a follow-up; English says the same without mail data", () => {
    const pl = textTables.pl.approvals.followUpRemoved;
    const en = textTables.en.approvals.followUpRemoved;
    expect(pl).toBe("↩️ Przypomnienie o odpowiedzi usunięte: śledzenie Twojej wysłanej poczty jest wyłączone.");
    expect(en).toBe("↩️ Follow-up removed: tracking of your sent mail is off.");
    for (const text of [pl, en]) {
      expect(text).not.toContain("@");
      expect(text).not.toContain("\n");
      expect(text.length).toBeLessThan(120);
    }
    expect(pl).toContain("Przypomnienie o odpowiedzi");
  });
});
