/// <reference types="bun" />
import type { Me, NotifyView } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DigestTimesCard } from "../components/settings/DigestTimesCard";
import { TelegramLockCard } from "../components/settings/TelegramLockCard";
import { NotifyCards, NotifySection, QuietHoursCard, ReportChannelCard } from "../components/settings/NotifyCards";
import { MeContext } from "../components/shell/MeProvider";
import { setLocaleForTest, t } from "../i18n";

// Only `organization` matters to the cards (`canWrite`).
const me = { organization: { plan: "active" } } as unknown as Me;
const MAILBOX = "0190f5a0-0000-7000-8000-000000000003";

const view = (over: Partial<NotifyView> = {}): NotifyView => ({
  quietStart: null,
  quietEnd: null,
  reportChannel: "telegram",
  reportMailboxId: null,
  mailboxes: [{ id: MAILBOX, address: "boss@x.test" }],
  telegramLinked: true,
  routes: {},
  routeDefaults: {
    urgent: { telegram: true, push: false },
    approvals: { telegram: true, push: false },
    updates: { telegram: true, push: false },
  },
  ...over,
});

function render(node: React.ReactNode): string {
  const value = { me, error: null, loading: false, reload: () => undefined };
  return renderToStaticMarkup(<MeContext.Provider value={value}>{node}</MeContext.Provider>);
}

describe("QuietHoursCard", () => {
  setLocaleForTest("en");

  test("no own hours: the default times and the default note", () => {
    const html = render(<QuietHoursCard view={view()} timeZone="Europe/Warsaw" onSaved={() => undefined} />);
    expect(html).toContain('data-card="quiet-hours"');
    expect(html).toContain('value="22:00"');
    expect(html).toContain('value="07:00"');
    expect(html).toContain(t("notify_quiet_default_note"));
    // Nothing changed and nothing own to reset: both buttons are off.
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });

  test("own hours show as they are, without the default note; the reset button is on", () => {
    const html = render(
      <QuietHoursCard
        view={view({ quietStart: "23:00", quietEnd: "06:00" })}
        timeZone="UTC"
        onSaved={() => undefined}
      />
    );
    expect(html).toContain('value="23:00"');
    expect(html).toContain('value="06:00"');
    expect(html).not.toContain(t("notify_quiet_default_note"));
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(1);
  });

  test("equal times show the no-quiet-hours note", () => {
    const html = render(
      <QuietHoursCard
        view={view({ quietStart: "10:00", quietEnd: "10:00" })}
        timeZone="UTC"
        onSaved={() => undefined}
      />
    );
    expect(html).toContain(t("notify_quiet_same_note"));
  });
});

describe("ReportChannelCard", () => {
  setLocaleForTest("en");

  test("telegram only: no mailbox list, no warning when Telegram is linked", () => {
    const html = render(<ReportChannelCard view={view()} onSaved={() => undefined} />);
    expect(html).toContain('data-card="report-channel"');
    expect(html).not.toContain('id="report-mailbox"');
    expect(html).not.toContain(t("notify_telegram_unlinked"));
  });

  test("mail with a mailbox shows the list with the stored mailbox and no Telegram warning", () => {
    const html = render(
      <ReportChannelCard
        view={view({ reportChannel: "mail", reportMailboxId: MAILBOX, telegramLinked: false })}
        onSaved={() => undefined}
      />
    );
    expect(html).toContain('id="report-mailbox"');
    expect(html).toContain("boss@x.test");
    expect(html).not.toContain(t("notify_telegram_unlinked"));
  });

  test("both without a linked chat warns; mail with no active mailbox shows the alert", () => {
    const both = render(
      <ReportChannelCard view={view({ reportChannel: "both", telegramLinked: false })} onSaved={() => undefined} />
    );
    expect(both).toContain(t("notify_telegram_unlinked"));
    const none = render(
      <ReportChannelCard view={view({ reportChannel: "mail", mailboxes: [] })} onSaved={() => undefined} />
    );
    expect(none).toContain(t("notify_no_mailbox"));
    expect(none).not.toContain('id="report-mailbox"');
  });
});

// Only `NotifyCards` loads `/api/me/notify`. The section mounts it only for a flag that is on, so with both flags off the Settings page
// makes no request (the GET answers 200 whatever the flags say).
describe("NotifySection", () => {
  test("every flag off: nothing is mounted, so no request goes out", () => {
    expect(NotifySection({ features: [], timeZone: "UTC" })).toBeNull();
    expect(NotifySection({ features: ["stats_page", "trust_ladder"], timeZone: "UTC" })).toBeNull();
  });

  test.each([
    { features: ["user_quiet_hours"], quiet: true, channel: false, routes: false },
    { features: ["report_mail"], quiet: false, channel: true, routes: false },
    { features: ["report_mail", "user_quiet_hours"], quiet: true, channel: true, routes: false },
    { features: ["web_push"], quiet: false, channel: false, routes: true },
  ])("the flags $features mount the loader with the matching cards", ({ features, quiet, channel, routes }) => {
    const node = NotifySection({ features, timeZone: "UTC" });
    expect(node?.type).toBe(NotifyCards);
    expect(node?.props).toEqual({ timeZone: "UTC", quiet, channel, routes });
  });
});

describe("DigestTimesCard", () => {
  setLocaleForTest("en");

  test("each time has a remove button named with that time", () => {
    const html = render(<DigestTimesCard times={["08:00", "18:00"]} timeZone="UTC" onSaved={() => undefined} />);
    expect(html).toContain('data-card="digest"');
    expect(html).toContain(`aria-label="${t("digest_remove", { time: "08:00" })}"`);
    expect(html).toContain(`aria-label="${t("digest_remove", { time: "18:00" })}"`);
    expect(html.match(/aria-label="Remove digest time/g)).toHaveLength(2);
    expect(html).toContain(`aria-label="${t("digest_add")}"`);
  });
});

describe("TelegramLockCard", () => {
  setLocaleForTest("en");

  test("a member sees the state as text and has no switch", () => {
    const html = render(<TelegramLockCard locked isOwnerRole={false} onSaved={() => undefined} />);
    expect(html).toContain('data-card="telegram-lock"');
    expect(html).toContain(t("tgl_state_on"));
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain(t("tgl_help"));
  });

  test("the owner has the switch named by its row", () => {
    const html = render(<TelegramLockCard locked={false} isOwnerRole onSaved={() => undefined} />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('for="tg-lock"');
  });
});
