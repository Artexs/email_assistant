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
