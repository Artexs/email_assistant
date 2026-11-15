import type { SentSyncView } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";

import { sentStatusLine } from "./sent-text";

function view(patch: Partial<SentSyncView> = {}): SentSyncView {
  return {
    flagOn: true,
    enabled: true,
    folder: "Sent",
    firstPassDone: true,
    lastSentAt: "2026-11-19T10:00:00.000Z",
    storedCount: 3,
    errorCode: null,
    ...patch,
  };
}

describe("sentStatusLine", () => {
  test("the switch off gives no line, whatever else is set", () => {
    expect(sentStatusLine(view({ enabled: false }))).toBeNull();
    expect(sentStatusLine(view({ enabled: false, flagOn: false, errorCode: "failed" }))).toBeNull();
  });

  test("a paused flag comes before every other rule", () => {
    expect(sentStatusLine(view({ flagOn: false, folder: null, errorCode: "failed", firstPassDone: false }))).toEqual({
      key: "sent_paused",
    });
  });

  test("no folder, or the code no_folder, gives sent_no_folder", () => {
    expect(sentStatusLine(view({ folder: null }))).toEqual({ key: "sent_no_folder" });
    expect(sentStatusLine(view({ errorCode: "no_folder" }))).toEqual({ key: "sent_no_folder" });
  });

  test("folder_missing and failed give their own keys", () => {
    expect(sentStatusLine(view({ errorCode: "folder_missing" }))).toEqual({ key: "sent_folder_missing" });
    expect(sentStatusLine(view({ errorCode: "failed" }))).toEqual({ key: "sent_failed" });
  });

  test("a pending first pass gives sent_first_pass; an error code comes before it", () => {
    expect(sentStatusLine(view({ firstPassDone: false }))).toEqual({ key: "sent_first_pass" });
    expect(sentStatusLine(view({ firstPassDone: false, errorCode: "failed" }))).toEqual({ key: "sent_failed" });
  });

  test("no stored mail or no last time gives sent_none", () => {
    expect(sentStatusLine(view({ storedCount: 0 }))).toEqual({ key: "sent_none" });
    expect(sentStatusLine(view({ lastSentAt: null }))).toEqual({ key: "sent_none" });
  });

  test("the default is sent_last with the time of the newest mail", () => {
    expect(sentStatusLine(view())).toEqual({ key: "sent_last", vars: { at: "2026-11-19T10:00:00.000Z" } });
  });

  test("every key of the card has an English and a Polish text with the right placeholders", () => {
    expect(en.sent_line.length).toBeGreaterThan(0);
    expect(pl.sent_line.length).toBeGreaterThan(0);
    expect(en.sent_last).toContain("{time}");
    expect(pl.sent_last).toContain("{time}");
    for (const key of [
      "sent_title",
      "sent_switch",
      "sent_line",
      "sent_off_note",
      "sent_no_folder",
      "sent_folder_missing",
      "sent_failed",
      "sent_first_pass",
      "sent_none",
      "sent_last",
      "sent_paused",
      "sent_on_toast",
      "sent_off_toast",
    ] as const) {
      expect(en[key].length, key).toBeGreaterThan(0);
      expect(pl[key].length, key).toBeGreaterThan(0);
    }
  });
});
