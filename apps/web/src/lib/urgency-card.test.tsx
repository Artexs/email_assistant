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
