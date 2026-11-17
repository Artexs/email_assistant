/// <reference types="bun" />
import type { SettingsWebView } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LoopSettingsCard } from "../components/settings/LoopSettingsCard";
import { setLocaleForTest, t } from "../i18n";
import { LOOP_WAIT_OPTIONS, loopControls } from "./loop-settings";

afterEach(() => setLocaleForTest("en"));

type View = Pick<SettingsWebView, "mailboxId" | "toolSwitches" | "sentTracking" | "loopWaitDays">;
const view = (over: Partial<View> = {}, autoFollowUp: boolean | "absent" = false): SettingsWebView =>
  ({
    mailboxId: "0190f5a0-0000-7000-8000-000000000003",
    toolSwitches: {
      move: true,
      flag: true,
      mark_read: true,
      create_draft: true,
      move_unsure: false,
      auto_follow_up: autoFollowUp === "absent" ? undefined : autoFollowUp,
    },
    sentTracking: "on",
    loopWaitDays: 3,
    ...over,
  }) as unknown as SettingsWebView;

function render(settings: SettingsWebView, isOwner = true): string {
  return renderToStaticMarkup(<LoopSettingsCard settings={settings} isOwner={isOwner} onChanged={() => undefined} />);
}

const selectTag = (html: string): string => /<select[^>]*>/.exec(html)?.[0] ?? "";
const switchTag = (html: string): string => /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";

describe("LoopSettingsCard (T3)", () => {
  setLocaleForTest("en");

  test("the flag off: the card is hidden (the switch is absent from the settings)", () => {
    expect(render(view({}, "absent"))).toBe("");
    expect(loopControls(view({}, "absent"), true).visible).toBe(false);
  });

  test("Sent tracking on: both controls work for the owner, no hint line, default 3 days", () => {
    const html = render(view());
    expect(html).toContain('data-card="loops"');
    expect(selectTag(html)).not.toContain('disabled=""');
    expect(switchTag(html)).not.toContain('disabled=""');
    expect(html).not.toContain(t("lset_needs_sent"));
    expect(html).toContain('<option value="3" selected="">3 working days</option>');
    expect(html).toContain(t("lset_wait_help"));
    expect(html).toContain(t("lset_auto_help"));
    expect(switchTag(html)).toContain('aria-checked="false"');
    expect([...LOOP_WAIT_OPTIONS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((html.match(/<option /g) ?? []).length).toBe(10);
  });

  test("Sent tracking off or paused: both controls are disabled and the line shows", () => {
    for (const sentTracking of ["off", "flag_off"] as const) {
      const html = render(view({ sentTracking }));
      expect(selectTag(html)).toContain('disabled=""');
      expect(switchTag(html)).toContain('disabled=""');
      expect(html).toContain("Turn on &#x27;Track my sent mail&#x27; to use open loops.");
    }
  });

  test("a member sees both controls disabled and no sent line while Sent tracking is on", () => {
    const html = render(view(), false);
    expect(selectTag(html)).toContain('disabled=""');
    expect(switchTag(html)).toContain('disabled=""');
    expect(html).not.toContain(t("lset_needs_sent"));
  });

  test("the saved wait and the switch show as stored", () => {
    const html = render(view({ loopWaitDays: 5 }, true));
    expect(html).toContain('<option value="5" selected="">5 working days</option>');
    expect(switchTag(html)).toContain('aria-checked="true"');
  });

  test("the Polish card has Polish texts and plural forms", () => {
    setLocaleForTest("pl");
    const html = render(view({ sentTracking: "off", loopWaitDays: 2 }));
    expect(html).toContain("Otwarte sprawy");
    expect(html).toContain("Czas oczekiwania przed przypomnieniem");
    expect(html).toContain('<option value="1">1 dzień roboczy</option>');
    expect(html).toContain('<option value="2" selected="">2 dni robocze</option>');
    expect(html).toContain('<option value="5">5 dni roboczych</option>');
    expect(html).not.toContain("Wait before a follow-up");
  });
});
