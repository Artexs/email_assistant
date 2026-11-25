/// <reference types="bun" />
import type { SettingsWebView } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { UrgencyForm } from "../components/rules/UrgencyCard";
import { setLocaleForTest, t } from "../i18n";

const MAILBOX = "0190f5a0-0000-7000-8000-000000000003";

function view(urgencyProfile: SettingsWebView["urgencyProfile"]): SettingsWebView {
  return { mailboxId: MAILBOX, urgencyProfile } as unknown as SettingsWebView;
}

const profile = {
  topics: [{ label: "Audit", keywords: ["audit", "tax"] }],
  deadlines: [
    { label: "Old filing", due: "2020-01-01" },
    { label: "Far filing", due: "2999-01-01" },
  ],
};

function render(settings: SettingsWebView, isOwner: boolean): string {
  return renderToStaticMarkup(
    <UrgencyForm
      settings={settings}
      address="a@x.test"
      isOwner={isOwner}
      timeZone="Europe/Warsaw"
      onSaved={() => undefined}
      onMissing={() => undefined}
    />
  );
}

describe("UrgencyForm", () => {
  setLocaleForTest("en");

  test("an owner gets the save button, the add buttons and the VIP link; Clear all only with a stored profile", () => {
    const stored = render(view(profile), true);
    expect(stored).toContain('type="submit"');
    expect(stored).toContain(t("urg_topic_add"));
    expect(stored).toContain(t("urg_deadline_add"));
    expect(stored).toContain(t("urg_clear"));
    expect(stored).toContain('href="#rules-vip"');
    expect(render(view(null), true)).not.toContain(t("urg_clear"));
  });

  test("a deadline in the past is marked ended and struck out; a future one is not", () => {
    const html = render(view(profile), true);
    expect(html.match(/data-ended="true"/g)).toHaveLength(1);
    expect(html).toContain(t("urg_ended"));
    expect(html).toContain("line-through");
  });

  test("the owner form has the two headings by id and one remove button per topic", () => {
    const twoTopics = view({ ...profile, topics: [...profile.topics, { label: "Visa", keywords: [] }] });
    const html = render(twoTopics, true);
    expect(html).toMatch(new RegExp(`<h3 id="urg-topics-title"[^>]*>${t("urg_topics_title")}</h3>`));
    expect(html).toMatch(new RegExp(`<h3 id="urg-deadlines-title"[^>]*>${t("urg_deadlines_title")}</h3>`));
    expect(html.match(/aria-label="Remove topic \d"/g)).toEqual([
      'aria-label="Remove topic 1"',
      'aria-label="Remove topic 2"',
    ]);
  });

  test("a member sees the profile with no input, no save, no add and no clear button", () => {
    const html = render(view(profile), false);
    expect(html).toContain("Audit");
    expect(html).toContain("audit, tax");
    expect(html).toContain("Old filing");
    expect(html).toContain(t("urg_ended"));
    expect(html).toContain('href="#rules-vip"');
    for (const marker of ["<input", "<button", 'type="submit"']) expect(html).not.toContain(marker);
  });

  test("the read-only view of an empty profile says so", () => {
    const html = render(view(null), false);
    expect(html).toContain(t("urg_topics_empty"));
    expect(html).toContain(t("urg_deadlines_empty"));
  });

  test("the card keeps no second list of VIP people: it only links to the VIP rules", () => {
    expect(render(view(profile), true)).toContain(t("urg_vip_text"));
  });
});

// The wording that the review of the card fixed (calques and a sentence that read "people are rules").
describe("urgency texts", () => {
  test("Polish", () => {
    setLocaleForTest("pl");
    expect(t("urg_help")).toBe(
      "Tematy i terminy dla tej skrzynki. Liczą się, gdy kontrola pilnych wiadomości z nich korzysta."
    );
    expect(t("urg_deadlines_help")).toBe("Termin, który minął, zostaje na liście, dopóki go nie usuniesz.");
    expect(t("urg_err_topic_nul", { n: 1 })).toBe("Temat 1: tekst zawiera niedozwolony znak.");
    expect(t("urg_err_deadline_nul", { n: 2 })).toBe("Termin 2: tekst zawiera niedozwolony znak.");
    expect(t("urg_topics_help")).toContain("(najwyżej 10 na temat)");
    expect(t("urg_vip_text")).toBe("Osoby VIP ustawiasz w regułach VIP dla nadawców.");
    expect(t("urg_clear_title")).toBe("Usunąć wszystkie tematy i terminy?");
    expect(t("urg_clear_text", { address: "a@x.test" })).toBe(
      "Usuniesz wszystkie tematy i terminy skrzynki a@x.test. Reguły VIP pozostaną bez zmian."
    );
    expect(t("urg_err_keywords_many", { n: 2 })).toBe("Temat 2: podaj najwyżej 10 słów kluczowych.");
    expect(t("urg_err_topics_many")).toBe("Możesz dodać najwyżej 20 tematów.");
    expect(t("urg_err_deadlines_many")).toBe("Możesz dodać najwyżej 20 terminów.");
  });

  test("English", () => {
    setLocaleForTest("en");
    expect(t("urg_help")).toBe(
      "Topics and deadlines for this mailbox. They count when the urgent-mail check uses them."
    );
    expect(t("urg_deadlines_help")).toBe("An ended deadline stays in the list until you remove it.");
    expect(t("urg_err_topic_nul", { n: 1 })).toBe("Topic 1: the text has a character that is not allowed.");
    expect(t("urg_err_deadline_nul", { n: 2 })).toBe("Deadline 2: the text has a character that is not allowed.");
    expect(t("urg_topics_help")).toContain("(up to 10 per topic)");
    expect(t("urg_err_topics_many")).toBe("You can add at most 20 topics.");
    expect(t("urg_err_deadlines_many")).toBe("You can add at most 20 deadlines.");
  });
});
