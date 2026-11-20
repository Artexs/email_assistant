import { describe, expect, test } from "bun:test";

import { operatorTexts } from "./operator";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const AT = "2026-11-18T10:00:00.000Z";
const UNTIL = "2026-11-18T10:10:00.000Z";

describe("operator notice texts", () => {
  test("English keeps the texts that the operator chat got before the move, byte for byte", () => {
    const en = operatorTexts.en;
    expect(en.trialEnds(ORG, AT)).toBe(`Trial of org ${ORG} ends ${AT}.`);
    expect(en.trialEnded(ORG, AT)).toBe(`Trial of org ${ORG} ended ${AT}.`);
    expect(en.authError24h(BOX, ORG, AT)).toBe(`Mailbox ${BOX} of org ${ORG} has been in auth_error since ${AT}.`);
    expect(en.llmCap(BOX, ORG, 300, AT)).toBe(
      `Mailbox ${BOX} of org ${ORG} reached the daily LLM cap (300 calls) on the quota day from ${AT}.`
    );
    expect(en.authMailFailed("reset", USER, ORG, "EAUTH")).toBe(
      `Auth mail reset to user ${USER} of org ${ORG} failed (EAUTH).`
    );
    expect(en.sendLimit(BOX, ORG, "mailbox_hour", AT, UNTIL)).toBe(
      `Mailbox ${BOX} of org ${ORG} hit the send limit mailbox_hour at ${AT}; its sends wait until ${UNTIL}.`
    );
  });

  test("Polish has a fixed value for each text", () => {
    const pl = operatorTexts.pl;
    expect(pl.trialEnds(ORG, AT)).toBe(`Okres próbny organizacji ${ORG} kończy się ${AT}.`);
    expect(pl.trialEnded(ORG, AT)).toBe(`Okres próbny organizacji ${ORG} zakończył się ${AT}.`);
    expect(pl.authError24h(BOX, ORG, AT)).toBe(`Skrzynka ${BOX} organizacji ${ORG} ma stan auth_error od ${AT}.`);
    expect(pl.authMailFailed("reset", USER, ORG, "EAUTH")).toBe(
      `Nie udało się wysłać wiadomości uwierzytelniającej (reset) do użytkownika ${USER} organizacji ${ORG} (EAUTH).`
    );
    expect(pl.sendLimit(BOX, ORG, "mailbox_hour", AT, UNTIL)).toBe(
      `Skrzynka ${BOX} organizacji ${ORG} osiągnęła limit wysyłki mailbox_hour o ${AT}; jej wysyłki czekają do ${UNTIL}.`
    );
  });

  test("the Polish cap text takes the plural form of the count", () => {
    const pl = operatorTexts.pl;
    expect(pl.llmCap(BOX, ORG, 1, AT)).toContain("(1 wywołanie)");
    expect(pl.llmCap(BOX, ORG, 3, AT)).toContain("(3 wywołania)");
    expect(pl.llmCap(BOX, ORG, 300, AT)).toContain("(300 wywołań)");
    expect(pl.llmCap(BOX, ORG, 22, AT)).toContain("(22 wywołania)");
  });
});

// A fact reader like the one of `renderSloAlert`, with fixed values.
const reader =
  (values: Record<string, number>) =>
  (key: string, decimals = 0): string =>
    (values[key] ?? 0).toFixed(decimals);

describe("the urgent latency fact line", () => {
  test.each([
    { locale: "en", mails: 0, line: "No urgent mail waits too long" },
    { locale: "en", mails: 1, line: "1 urgent mail not told in time, longest wait 25 min" },
    { locale: "en", mails: 2, line: "2 urgent mails not told in time, longest wait 25 min" },
    { locale: "pl", mails: 0, line: "Brak pilnych wiadomości czekających zbyt długo" },
    {
      locale: "pl",
      mails: 3,
      line: "Pilne wiadomości bez powiadomienia na czas: 3; najdłuższe oczekiwanie 25 min",
    },
  ] as const)("$locale with $mails mails: $line", ({ locale, mails, line }) => {
    const facts = operatorTexts[locale].slo.facts.slo_urgent_latency;
    expect(facts(reader({ mails, max_wait_min: 25 }))).toBe(line);
  });
});

describe("the LLM errors fact line", () => {
  test.each([
    { locale: "en", calls: 0, quota: 0, line: "No LLM calls in the window" },
    { locale: "en", calls: 10, quota: 0, line: "3 of 10 LLM calls failed (30.0 %)" },
    {
      locale: "en",
      calls: 0,
      quota: 2,
      line: "No LLM calls in the window, 2 organizations paused by a spent quota",
    },
    { locale: "pl", calls: 0, quota: 0, line: "Brak wywołań LLM w oknie" },
    { locale: "pl", calls: 10, quota: 0, line: "Nieudane wywołania LLM: 3 z 10 (30.0%)" },
    {
      locale: "pl",
      calls: 10,
      quota: 2,
      line: "Nieudane wywołania LLM: 3 z 10 (30.0%); organizacje z wyczerpanym limitem: 2",
    },
    {
      locale: "pl",
      calls: 0,
      quota: 1,
      line: "Brak wywołań LLM w oknie; organizacje z wyczerpanym limitem: 1",
    },
  ] as const)("$locale with $calls calls and $quota paused: $line", ({ locale, calls, quota, line }) => {
    const facts = operatorTexts[locale].slo.facts.slo_llm_errors;
    expect(facts(reader({ calls, failed: 3, pct: 30, quota_orgs: quota }))).toBe(line);
  });
});

describe("the backup age fact line", () => {
  test.each([
    { locale: "en", age: 0, failed: 0, missing: 0, line: "Last good backup 0 h ago" },
    { locale: "pl", age: 0, failed: 0, missing: 0, line: "Ostatnia udana kopia sprzed 0 h" },
    { locale: "pl", age: -1, failed: 0, missing: 0, line: "Brak udanej kopii w historii" },
    {
      locale: "pl",
      age: -1,
      failed: 1,
      missing: 0,
      line: "Ostatnia kopia nie powiodła się; brak udanej kopii w historii",
    },
  ] as const)("$locale age $age failed $failed missing $missing: $line", ({ locale, age, failed, missing, line }) => {
    const facts = operatorTexts[locale].slo.facts.slo_backup_age;
    expect(facts(reader({ age_h: age, failed, missing }))).toBe(line);
  });
});
