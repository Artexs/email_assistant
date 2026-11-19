import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { pl } from "./pl";
import { enDetail } from "./texts/en-detail";
import { plDetail } from "./texts/pl-detail";

// The texts of the Telegram detail choice, the owner's lock and the notice routes: the English words that the stage fixes, the informal
// "ty" form, whole sentences, and the same placeholders in both languages.
describe("the Telegram detail, lock and route texts", () => {
  test("the English words that the stage fixes", () => {
    expect([en.tgd_minimal_option, en.tgd_minimal_text, en.tgd_full_option, en.tgd_full_text, en.tgd_locked]).toEqual([
      "Counts and links only (recommended)",
      "Telegram gets how many items wait and a link to the panel. No sender, subject, summary or drafts.",
      "Full",
      'Telegram gets the sender, subject, AI summary and drafts, with "Send" buttons. Telegram stores these messages on its servers.',
      "Your organization allows only counts and links.",
    ]);
    expect(en.tgl_label).toBe("Telegram: counts and links only for everyone");
    expect([en.nr_group_urgent, en.nr_group_approvals, en.nr_group_updates]).toEqual([
      "Urgent mail",
      "Approvals",
      "Updates",
    ]);
    expect([en.nr_telegram, en.nr_phone, en.nr_both]).toEqual(["Telegram", "Phone", "Both"]);
  });

  test("every key is in both languages with the same placeholders and no empty text", () => {
    expect(Object.keys(plDetail)).toEqual(Object.keys(enDetail));
    const names = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
    for (const key of Object.keys(enDetail) as (keyof typeof enDetail)[]) {
      expect(pl[key].trim()).not.toBe("");
      expect([key, names(pl[key])]).toEqual([key, names(en[key])]);
    }
  });

  test("every Polish text is informal (no Pan, Pani, Państwo) and a whole sentence or a short label", () => {
    for (const [key, text] of Object.entries(plDetail)) {
      expect(text).not.toMatch(/\b(Pan|Pani|Państw\w*|Pana|Panu|Pani)\b/);
      // A sentence ends with a full stop (a label, a title or a text with a placeholder only does not).
      if (/(_text|_help|_hint|_toast|_locked|_locked_now|_state_on|_state_off)$/.test(key)) {
        expect([key, text.endsWith(".")]).toEqual([key, true]);
      }
    }
  });

  test("the Polish texts of the review fixes", () => {
    expect([pl.tgd_full_option, pl.tgd_full_short, pl.tgd_current_label, pl.tgl_title, pl.nr_both]).toEqual([
      "Pełna treść",
      "Pełna treść",
      "Co teraz dostaje Telegram:",
      "Zakres danych w Telegramie (cała organizacja)",
      "Oba kanały",
    ]);
    expect(pl.tgd_full_text).toContain("„Wyślij”");
    expect(pl.tgd_locked_now).toBe(
      "Twoja organizacja ograniczyła Telegram do liczb i linków. Twój wybór (pełna treść) znów zacznie obowiązywać po wyłączeniu blokady."
    );
    // The lock help promises that each person gets their own choice back; the member card does not show it (the owner wording).
    expect(en.tgl_help).toContain("When the lock is turned off, each person gets their own choice again.");
    // Digests and reports never go to the phone: the help names the report channel instead of "Telegram and mail".
    expect(en.nr_help).toContain("Digests and reports never go to the phone");
    expect(pl.nr_help).toContain("zgodnie z ustawieniem raportów");
  });

  test("the Polish texts that the stage fixes", () => {
    expect(pl.tgd_minimal_option).toBe("Tylko liczby i linki (zalecane)");
    expect(pl.tgd_locked).toBe("Twoja organizacja dopuszcza tylko liczby i linki.");
    expect(pl.nr_default.replace("{value}", "Oba")).toBe("Oba (domyślnie)");
  });
});
