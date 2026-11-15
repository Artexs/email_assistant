/// <reference types="bun" />
import type { SentSyncView, SettingsWebView } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SentSyncLine } from "../components/mailboxes/ConnectDialog";
import { SentMailCard } from "../components/settings/SentMailCard";
import { setLocaleForTest, t } from "../i18n";

const sentView = (patch: Partial<SentSyncView> = {}): SentSyncView => ({
  flagOn: true,
  enabled: true,
  folder: "Sent",
  firstPassDone: true,
  lastSentAt: "2026-11-19T10:00:00.000Z",
  storedCount: 3,
  errorCode: null,
  ...patch,
});

function render(sentSync: SentSyncView | null, isOwner = true): string {
  const settings = { mailboxId: "0190f5a0-0000-7000-8000-000000000003", sentSync } as unknown as SettingsWebView;
  return renderToStaticMarkup(
    <SentMailCard settings={settings} isOwner={isOwner} timeZone="Europe/Warsaw" onChanged={() => undefined} />
  );
}

// The disabled flag of the one switch of the card.
const switchDisabled = (html: string): boolean =>
  /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0].includes(' disabled=""') ?? false;

describe("SentMailCard", () => {
  setLocaleForTest("en");

  test("shows the title, the switch, the fixed line, the folder and the off note", () => {
    const html = render(sentView());
    expect(html).toContain('data-card="sent"');
    for (const key of ["sent_title", "sent_switch", "sent_line", "sent_off_note"] as const) {
      expect(html).toContain(t(key));
    }
    expect(html).toContain("Sent</p>");
    expect(html).toContain('aria-checked="true"');
  });

  test("a null view renders nothing", () => {
    expect(render(null)).toBe("");
  });

  test("an owner can use the switch; a member cannot", () => {
    expect(switchDisabled(render(sentView()))).toBe(false);
    expect(switchDisabled(render(sentView(), false))).toBe(true);
  });

  test("paused and on: the owner can turn it off; paused and off: the switch is disabled", () => {
    expect(switchDisabled(render(sentView({ flagOn: false, enabled: true })))).toBe(false);
    expect(switchDisabled(render(sentView({ flagOn: false, enabled: false })))).toBe(true);
  });

  test("the status line follows sentStatusLine; no line while the switch is off", () => {
    expect(render(sentView({ flagOn: false }))).toContain(t("sent_paused"));
    expect(render(sentView({ errorCode: "failed" }))).toContain(t("sent_failed"));
    expect(render(sentView({ storedCount: 0 }))).toContain(t("sent_none"));
    const off = render(sentView({ enabled: false }));
    expect(off).not.toContain(t("sent_failed"));
    expect(off).not.toContain(t("sent_first_pass"));
    expect(off).toContain('aria-checked="false"');
  });

  test("sent_last shows a formatted time, not the ISO string", () => {
    const html = render(sentView());
    expect(html).toContain("Last sent mail seen: ");
    expect(html).not.toContain("2026-11-19T10:00:00.000Z");
  });

  test("the Polish card has no English text", () => {
    setLocaleForTest("pl");
    try {
      const html = render(sentView());
      expect(html).toContain("Śledź moją wysłaną pocztę");
      expect(html).not.toContain("Track my sent mail");
    } finally {
      setLocaleForTest("en");
    }
  });
});

describe("the connect line", () => {
  test("shows the sent_line text only when the flag is on", () => {
    setLocaleForTest("en");
    expect(renderToStaticMarkup(<SentSyncLine show={true} />)).toContain(t("sent_line"));
    expect(renderToStaticMarkup(<SentSyncLine show={false} />)).toBe("");
  });
});
