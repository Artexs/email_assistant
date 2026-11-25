import { afterEach, describe, expect, test } from "bun:test";
import {
  categories,
  labelCategories,
  pickAnswer,
  pickedText,
  rightAnswer,
  textTables,
  userLocales,
  type ActivityItem,
  type SenderLine,
} from "@ea/core/web";

import { setLocaleForTest } from "../i18n";
import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import {
  categoryName,
  confidenceText,
  delegationText,
  feedbackStateText,
  feedbackToast,
  ruleLine,
  ruleName,
  senderLineText,
  senderText,
  subjectText,
  undoToast,
} from "./activity-text";

afterEach(() => setLocaleForTest("en"));

const kinds = ["started", "already", "nothing", "too_old", "held"] as const;

function feedback(patch: Partial<NonNullable<ActivityItem["feedback"]>>): NonNullable<ActivityItem["feedback"]> {
  return { verdict: "right", trueCategory: null, source: "web", at: "2026-11-11T10:00:00.000Z", ...patch };
}

// The core texts keep their emoji for Telegram; the panel texts have none. The tie is for the words.
function withoutLeadingEmoji(text: string): string {
  return text.replace(/^\p{Extended_Pictographic}\uFE0F?\s+/u, "");
}

describe("words tied to the Telegram source", () => {
  for (const locale of userLocales) {
    const texts = textTables[locale];

    test(`${locale}: undo toasts equal the core undo texts`, () => {
      setLocaleForTest(locale);
      for (const kind of kinds) expect(undoToast(kind)).toBe(withoutLeadingEmoji(texts.answers.undo[kind]));
    });

    test(`${locale}: category names equal the core texts`, () => {
      setLocaleForTest(locale);
      for (const c of categories) {
        expect(categoryName(c)).toBe(texts.categories[c]);
      }
    });

    test(`${locale}: right and pick toasts equal the Telegram answers`, () => {
      setLocaleForTest(locale);
      for (const c of labelCategories) {
        expect(feedbackToast("right", { saved: true, verdict: "right", aiCategory: c }, c)).toBe(
          withoutLeadingEmoji(rightAnswer(true, c, texts))
        );
        expect(feedbackToast("right", { saved: false, verdict: "right", aiCategory: c }, c)).toBe(
          rightAnswer(false, c, texts)
        );
      }
      for (const picked of labelCategories) {
        for (const ai of labelCategories) {
          expect(feedbackToast("pick", { saved: true, verdict: "wrong", aiCategory: ai }, picked)).toBe(
            withoutLeadingEmoji(pickedText(picked, ai, true, texts))
          );
        }
      }
      // Not saved: the same words as the Telegram pick answer.
      expect(feedbackToast("pick", { saved: false, verdict: "wrong", aiCategory: "info" }, "urgent")).toBe(
        pickAnswer(false, texts)
      );
    });
  }
});

describe("row texts", () => {
  test("fallbacks and confidence", () => {
    expect(subjectText(null)).toBe("(no subject)");
    expect(subjectText("")).toBe("(no subject)");
    expect(subjectText("   ")).toBe("(no subject)");
    expect(subjectText("Hi")).toBe("Hi");
    expect(senderText("")).toBe("(unknown sender)");
    expect(senderText(" \t")).toBe("(unknown sender)");
    expect(senderText(null)).toBe("(unknown sender)");
    expect(senderText("a@x.test")).toBe("a@x.test");
    expect(confidenceText(0.934)).toBe("93 %");
  });

  test("feedback state", () => {
    expect(feedbackStateText(null)).toBe("Not rated yet");
    expect(feedbackStateText(feedback({ verdict: "right", trueCategory: "info" }))).toBe("You said: right");
    expect(feedbackStateText(feedback({ verdict: "wrong", trueCategory: "info" }))).toBe("You said: Info");
    expect(feedbackStateText(feedback({ verdict: "wrong", source: "undo" }))).toBe("You said: wrong (Undo)");
    expect(feedbackStateText(feedback({ verdict: "wrong", source: "telegram" }))).toBe("You said: wrong");
    expect(feedbackStateText(feedback({ verdict: "wrong", source: "imap_move" }))).toBe("You said: wrong");
  });

  test("delegation text", () => {
    expect(delegationText({ delegateName: "Ola", status: "drafted", dueAt: null })).toBe("Ola · Drafted");
    expect(delegationText({ delegateName: null, status: "drafted", dueAt: null })).toBe("A delegate · Drafted");
  });
});

describe("the rule hit (F110 stage 16)", () => {
  const rules = ["vip", "whitelist", "blocklist"] as const;

  test("en: the badge and the panel line", () => {
    setLocaleForTest("en");
    expect(rules.map(ruleName)).toEqual(["VIP sender", "Whitelisted sender", "Blocked sender"]);
    expect(rules.map(ruleLine)).toEqual(["Rule: VIP sender", "Rule: whitelisted sender", "Rule: blocked sender"]);
  });

  test("pl: the badge and the panel line, with the words of the Rules page", () => {
    setLocaleForTest("pl");
    expect(rules.map(ruleName)).toEqual(["Nadawca VIP", "Nadawca z listy dozwolonych", "Nadawca z listy blokowanych"]);
    expect(rules.map(ruleLine)).toEqual([
      "Reguła: nadawca VIP",
      "Reguła: nadawca z listy dozwolonych",
      "Reguła: nadawca z listy blokowanych",
    ]);
  });
});

describe("the sender line", () => {
  const line = (patch: Partial<SenderLine> = {}): SenderLine => ({
    relation: "known",
    received: 8,
    answered: 6,
    userMailsTo: 3,
    lastSeenDaysAgo: 2,
    days: 90,
    ...patch,
  });

  test("en: the full line, with no wrote part at 0 and the new sender", () => {
    setLocaleForTest("en");
    expect(senderLineText(line())).toBe(
      "Known · you answered 6 of 8 mails in 90 days · you wrote to them 3 times · last mail 2 days ago"
    );
    expect(senderLineText(line({ userMailsTo: 0 }))).toBe(
      "Known · you answered 6 of 8 mails in 90 days · last mail 2 days ago"
    );
    expect(
      senderLineText(line({ relation: "new", received: 1, answered: 0, userMailsTo: 0, lastSeenDaysAgo: null }))
    ).toBe("New · you answered 0 of 1 mails in 90 days");
  });

  test("en: today, the other relation words, and no answered part without a received mail", () => {
    setLocaleForTest("en");
    expect(senderLineText(line({ lastSeenDaysAgo: 0 }))).toEndWith(" · last mail today");
    const words = (["delegate", "vip", "bulk", "known", "new"] as const).map((relation) =>
      senderLineText(line({ relation, received: 0, answered: 0, userMailsTo: 0, lastSeenDaysAgo: null }))
    );
    expect(words).toEqual(["Delegate", "VIP", "Bulk sender", "Known", "New"]);
  });

  test("pl: the same cases", () => {
    setLocaleForTest("pl");
    expect(senderLineText(line())).toBe(
      "Znany · odpowiedź na 6 z 8 wiadomości w 90 dni · Twoje wiadomości do nadawcy: 3 · ostatnia wiadomość 2 dni temu"
    );
    expect(senderLineText(line({ userMailsTo: 0, lastSeenDaysAgo: 0 }))).toBe(
      "Znany · odpowiedź na 6 z 8 wiadomości w 90 dni · ostatnia wiadomość dzisiaj"
    );
    expect(
      senderLineText(line({ relation: "new", received: 1, answered: 0, userMailsTo: 0, lastSeenDaysAgo: null }))
    ).toBe("Nowy · odpowiedź na 0 z 1 wiadomości w 90 dni");
    const words = (["delegate", "vip", "bulk", "known", "new"] as const).map((relation) =>
      senderLineText(line({ relation, received: 0, answered: 0, userMailsTo: 0, lastSeenDaysAgo: null }))
    );
    expect(words).toEqual(["Delegat", "VIP", "Nadawca masowy", "Znany", "Nowy"]);
  });
});

describe("no emoji in the panel texts", () => {
  const tables = { en, pl };
  for (const locale of userLocales) {
    test(`${locale}: Activity, undo and draft reply texts have no pictograph`, () => {
      const withEmoji = Object.entries(tables[locale])
        .filter(([key]) => key.startsWith("act_") || key === "undo_started" || key.startsWith("rp_draft_reply"))
        .filter(([, value]) => /\p{Extended_Pictographic}/u.test(value))
        .map(([key]) => key);
      expect(withEmoji).toEqual([]);
    });
  }
});
