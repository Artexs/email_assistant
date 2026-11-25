/// <reference types="bun" />
import { barCategories, toolSwitchNames, type MailboxView, type SettingsWebView } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CategoriesCard } from "../components/settings/CategoriesCard";
import { ModeCard } from "../components/settings/ModeCard";
import { setLocaleForTest, t } from "../i18n";

afterEach(() => setLocaleForTest("en"));

const ID = "0190f5a0-0000-7000-8000-000000000003";
const gate = { decision: "go", precision: 0.99, kept: 120, wilsonLower: 0.98, rated: 120 };

const settings = (): SettingsWebView =>
  ({
    mailboxId: ID,
    mode: "assist",
    movesSupported: true,
    toolSwitches: {
      move: true,
      flag: false,
      mark_read: true,
      create_draft: true,
      move_unsure: false,
      reply_drafts: false,
    },
    categories: barCategories.map((category) => ({ category, auto: false, threshold: 0.9, gate })),
    bar: 0.98,
    minKept: 30,
  }) as unknown as SettingsWebView;

const mailbox = (oauthProvider: "google" | null) =>
  ({ id: ID, address: "a@x.test", oauthProvider }) as unknown as MailboxView;

const modeCard = (over: { isOwner?: boolean; oauth?: "google" | null } = {}) =>
  renderToStaticMarkup(
    <ModeCard
      mailbox={mailbox(over.oauth ?? null)}
      settings={settings()}
      isOwner={over.isOwner ?? true}
      onChanged={() => undefined}
    />
  );

const tagOf = (html: string, id: string): string => new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
const labelOf = (html: string, id: string): string =>
  new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)</label>`).exec(html)?.[1] ?? "";

describe("the mode card switches", () => {
  setLocaleForTest("en");

  test("each switch is named by its row title and shows its state", () => {
    const html = modeCard();
    expect(labelOf(html, "switch_move")).toBe(t("switch_move"));
    expect(tagOf(html, "switch_move")).toContain('aria-checked="true"');
    expect(tagOf(html, "switch_move")).not.toContain('disabled=""');
    expect(labelOf(html, "switch_flag")).toBe(t("switch_flag"));
    expect(tagOf(html, "switch_flag")).toContain('aria-checked="false"');
  });

  test("a member: every switch is disabled and no mode button shows", () => {
    const html = modeCard({ isOwner: false });
    const ids = [...toolSwitchNames.map((name) => `switch_${name}`), "switch_reply_drafts"];
    expect(ids.filter((id) => !tagOf(html, id).includes('disabled=""'))).toEqual([]);
    expect(html).not.toContain(t("mode_to_assist"));
    expect(html).not.toContain(t("mode_to_shadow"));
    expect(modeCard()).toContain(t("mode_to_shadow"));
  });

  test("the reply drafts switch of an OAuth mailbox is disabled and described by both help lines", () => {
    const html = modeCard({ oauth: "google" });
    const tag = tagOf(html, "switch_reply_drafts");
    expect(tag).toContain('disabled=""');
    expect(tag).toContain('aria-describedby="switch_reply_drafts_help switch_reply_drafts_oauth"');
    expect(html).toContain(`<p id="switch_reply_drafts_help">${t("rs_switch_help")}</p>`);
    expect(html).toContain(`<p id="switch_reply_drafts_oauth">${t("rs_switch_oauth")}</p>`);
  });
});

describe("the categories card", () => {
  setLocaleForTest("en");
  const card = () =>
    renderToStaticMarkup(<CategoriesCard settings={settings()} isOwner={true} onChanged={() => undefined} />);

  test("one pill per category, in the order of the list, and no emoji in the rows", () => {
    const html = card();
    const pills = [...html.matchAll(/data-slot="category-pill" data-category="([a-z_]+)"/g)].map((match) => match[1]);
    expect(pills).toEqual([...barCategories]);
    const rows = [...html.matchAll(/<div data-slot="row"[\s\S]*?(?=<div data-slot="row"|$)/g)].map((match) => match[0]);
    expect(rows).toHaveLength(barCategories.length);
    expect(rows.filter((row) => /\p{Extended_Pictographic}/u.test(row))).toEqual([]);
  });
});
