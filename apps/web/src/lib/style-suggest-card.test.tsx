/// <reference types="bun" />
import type { ProfileView } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StyleSuggestView, type SuggestState } from "../components/settings/StyleSuggest";
import { ReplyStyleForm } from "../components/settings/ReplyStyleCard";
import { setLocaleForTest, t } from "../i18n";

import type { SuggestButton } from "./style-suggest";

afterEach(() => setLocaleForTest("en"));

const ACTIVE = { kind: "active" } as const;

function view(state: SuggestState, button: Exclude<SuggestButton, { kind: "hidden" }> = ACTIVE): string {
  return renderToStaticMarkup(
    <StyleSuggestView
      button={button}
      state={state}
      onAsk={() => undefined}
      onUse={() => undefined}
      onDiscard={() => undefined}
    />
  );
}

const buttons = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1] ?? "");

describe("the suggest box of the style card", () => {
  test("idle: the button and its note, no box", () => {
    const html = view({ kind: "idle" });
    expect(buttons(html)).toEqual([t("rs_suggest_button")]);
    expect(html).toContain(t("rs_suggest_note"));
    expect(html).toContain('data-suggest="idle"');
    expect(html).not.toContain("data-suggest-text");
  });

  test("a suggestion shows as text with its count line and the two actions", () => {
    const html = view({ kind: "shown", answer: { kind: "suggestion", text: "Krótko.", count: 7 } });
    expect(/<p data-suggest-text="" [^>]*>Krótko\.<\/p>/.test(html)).toBe(true);
    expect(html).toContain("Based on 7 sent mails");
    expect(buttons(html)).toEqual([t("rs_suggest_button"), "Use this text", "Discard"]);
  });

  test("the text of a suggestion is never markup", () => {
    const html = view({
      kind: "shown",
      answer: { kind: "suggestion", text: "<img src=x onerror=alert(1)>", count: 5 },
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("too few sent mails: the note line with the count, no box", () => {
    const html = view({ kind: "shown", answer: { kind: "note", key: "rs_suggest_too_few", count: 3 } });
    expect(html).toContain("Not enough sent mail yet (3 of 5). Try again after you send more mail.");
    expect(html).not.toContain("data-suggest-text");
    expect(buttons(html)).toEqual([t("rs_suggest_button")]);
  });

  test("while the call runs the button is off and a status line shows", () => {
    const html = view({ kind: "running" });
    expect(/<button[^>]*disabled=""[^>]*>Suggest my style from my sent mail</.test(html)).toBe(true);
    expect(html).toContain(t("rs_suggest_running"));
  });

  test("a failed call shows an alert with the text of the error", () => {
    const html = view({ kind: "failed", key: "error_generic" });
    expect(html).toContain(`role="alert"`);
    expect(html).toContain(t("error_generic"));
  });

  test("an off button gives the reason line and no button", () => {
    const html = view({ kind: "idle" }, { kind: "off", key: "rs_suggest_sent_off" });
    expect(buttons(html)).toEqual([]);
    expect(html).toContain("Turn on &#x27;Track my sent mail&#x27; to use this.");
    expect(html).not.toContain(t("rs_suggest_note"));
  });
});

describe("the suggest box in the style card", () => {
  const profile: ProfileView = {
    displayName: "Anna Nowak",
    signature: null,
    writingStyle: "Krótko.",
    fallbackName: "Owner Name",
    fallbackSignature: "",
  };
  const form = (suggest: SuggestButton, over: { isOwner?: boolean } = {}) =>
    renderToStaticMarkup(
      <ReplyStyleForm
        mailboxId="0190f5a0-0000-7000-8000-000000000003"
        view={profile}
        isOwner={over.isOwner ?? true}
        replyDraftsOn
        samplesBlocked={false}
        suggest={suggest}
        onSaved={() => undefined}
      />
    );

  test("an active button sits after the writing style field and before Save", () => {
    const html = form(ACTIVE);
    const at = (text: string) => html.indexOf(text);
    expect(at(t("rs_style_label"))).toBeGreaterThan(-1);
    expect(at(t("rs_suggest_button"))).toBeGreaterThan(at(t("rs_style_help")));
    expect(at(t("rs_suggest_button"))).toBeLessThan(at(">Save<"));
  });

  test("hidden: nothing of it in the card", () => {
    const html = form({ kind: "hidden" });
    expect(html).not.toContain(t("rs_suggest_button"));
    expect(html).not.toContain('data-card-part="style-suggest"');
  });
});
