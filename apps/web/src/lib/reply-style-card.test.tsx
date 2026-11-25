/// <reference types="bun" />
import type { MailboxView, ProfileView, SettingsWebView } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocaleForTest, t } from "../i18n";
import { en } from "../i18n/en";

import { ModeCard } from "../components/settings/ModeCard";
import { PreviewResult, ReplyStyleForm } from "../components/settings/ReplyStyleCard";

afterEach(() => setLocaleForTest("en"));

const ID = "0190f5a0-0000-7000-8000-000000000003";

const profile = (over: Partial<ProfileView> = {}): ProfileView => ({
  displayName: "Anna Nowak",
  signature: null,
  writingStyle: "Krótko.",
  fallbackName: "Owner Name",
  fallbackSignature: "Old org text",
  ...over,
});

function form(
  over: { isOwner?: boolean; replyDraftsOn?: boolean; view?: ProfileView; samplesBlocked?: boolean } = {}
): string {
  return renderToStaticMarkup(
    <ReplyStyleForm
      mailboxId={ID}
      view={over.view ?? profile()}
      isOwner={over.isOwner ?? true}
      replyDraftsOn={over.replyDraftsOn ?? true}
      samplesBlocked={over.samplesBlocked ?? false}
      suggest={{ kind: "hidden" }}
      onSaved={() => undefined}
    />
  );
}

const buttons = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1] ?? "");

describe("the style card", () => {
  setLocaleForTest("en");

  test("the owner with the flag on gets every field, the guided form, Apply, Save and Preview", () => {
    const html = form();
    for (const key of ["rs_name_label", "rs_signature_label", "rs_style_label", "rs_form_title"] as const) {
      expect(html).toContain(t(key));
    }
    expect(buttons(html)).toEqual([t("rs_apply"), t("save"), t("rs_preview"), t("rs_samples")]);
    expect(html).toContain(t("rs_apply_help"));
    expect(html).toContain(t("rs_preview_help"));
    expect(html).not.toContain("readOnly");
    // Save has nothing to save yet.
    expect(/<button[^>]*disabled=""[^>]*>Save</.test(html)).toBe(true);
    expect(html).toContain('value="Anna Nowak"');
    expect(html).toContain(t("sig_counter", { count: 7, max: 1000 }));
  });

  test("the sample button sits on the card with its note; it waits for the first read of today's run", () => {
    const html = form();
    expect(html).toContain(t("rs_samples_help"));
    expect(html).toContain(t("rs_samples_note"));
    expect(en.rs_samples).toBe("Show 3 sample drafts");
    expect(en.rs_samples_note).toBe("Samples are not saved in Drafts and cannot be sent.");
    // The English texts of the review fixes are fixed here, as the Polish ones are in `i18n/reply-style.test.ts`.
    expect(en.rs_samples_help).toBe(
      "Writes replies to up to 3 of your newest mails from the last 7 days that need an answer. You can ask once a day for each mailbox."
    );
    expect(en.rs_samples_none).toBe("No mail from the last 7 days can get a sample.");
    expect(en.rs_samples_limit).toBe("Samples for this mailbox were already asked for today. Try again later.");
    expect(en.rs_samples_no_draft).toBe("The assistant wrote no sample for this mail.");
    expect(/<button[^>]*disabled=""[^>]*>Show 3 sample drafts</.test(html)).toBe(true);
  });

  test("an OAuth mailbox gets the reason instead of the sample button; a member and the flag off get neither", () => {
    const oauth = form({ samplesBlocked: true });
    expect(oauth).toContain(t("rs_samples_oauth"));
    expect(buttons(oauth)).not.toContain(t("rs_samples"));
    for (const html of [form({ isOwner: false }), form({ replyDraftsOn: false })]) {
      expect(html).not.toContain(t("rs_samples_help"));
      expect(html).not.toContain(t("rs_samples_oauth"));
    }
  });

  test("a member sees the texts read-only: no button, no select, no guided form", () => {
    const html = form({ isOwner: false });
    expect(buttons(html)).toEqual([]);
    expect(html).not.toContain("<select");
    expect(html).not.toContain(t("rs_form_title"));
    expect((html.match(/readOnly=""/g) ?? []).length).toBe(3);
    expect(html).toContain('value="Anna Nowak"');
    expect(html).toContain("Krótko.");
  });

  test("the flag off: the name and the signature stay; the writing style, the form and Preview are gone", () => {
    const html = form({ replyDraftsOn: false });
    expect(html).toContain(t("rs_name_label"));
    expect(html).toContain(t("rs_signature_label"));
    expect(html).not.toContain(t("rs_style_label"));
    expect(html).not.toContain(t("rs_form_title"));
    expect(buttons(html)).toEqual([t("save")]);
    expect(html).not.toContain(t("rs_preview_help"));
  });

  test("an empty field shows the text in use; a field with a text does not", () => {
    const html = form({ view: profile({ displayName: null, signature: null }) });
    expect(html).toContain(t("rs_in_use", { text: "Owner Name" }));
    expect(html).toContain(t("rs_in_use", { text: "Old org text" }));
    const filled = form({ view: profile({ displayName: "Anna", signature: "Pozdrawiam" }) });
    expect(filled).not.toContain(t("rs_in_use", { text: "Owner Name" }));
    expect(filled).not.toContain(t("rs_in_use", { text: "Old org text" }));
  });

  test("a stored text is shown as text, never as markup", () => {
    const html = form({ view: profile({ signature: "<img src=x onerror=alert(1)>" }) });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("the answer of Preview", () => {
  setLocaleForTest("en");

  test("a body with markup shows as the literal text in a calm box, with the sample note", () => {
    const html = renderToStaticMarkup(
      <PreviewResult preview={{ state: "done", answer: { kind: "body", body: "<b>Hi</b>" } }} />
    );
    expect(html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain('data-slot="fact-box"');
    expect(html).toContain(t("rs_preview_note"));
    expect(html).not.toContain("role=");
  });

  test("a failed answer is an alert with its own text; idle and running show nothing", () => {
    const failed = renderToStaticMarkup(
      <PreviewResult preview={{ state: "done", answer: { kind: "failed", key: "rs_preview_limit" } }} />
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain(t("rs_preview_limit"));
    for (const state of ["idle", "running"] as const) {
      expect(renderToStaticMarkup(<PreviewResult preview={{ state }} />)).toBe(
        `<div aria-live="polite" data-preview="${state}"></div>`
      );
    }
  });
});

describe("the guided form", () => {
  setLocaleForTest("en");

  test("each of its four rows labels its control with a for attribute that matches the control id", () => {
    const html = form();
    for (const key of ["rs_form_address", "rs_form_greeting", "rs_form_sign_off", "rs_form_length"] as const) {
      const label = new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${t(key)}</label>`).exec(html);
      expect(label).not.toBeNull();
      expect(html).toContain(`id="${label?.[1] ?? "missing"}"`);
    }
  });
});

describe("the reply drafts switch in the mode card", () => {
  setLocaleForTest("en");
  const settings = (replyDrafts: boolean | undefined): SettingsWebView =>
    ({
      mailboxId: ID,
      mode: "assist",
      movesSupported: true,
      toolSwitches: {
        move: true,
        flag: true,
        mark_read: true,
        create_draft: true,
        move_unsure: false,
        ...(replyDrafts === undefined ? {} : { reply_drafts: replyDrafts }),
      },
    }) as unknown as SettingsWebView;
  const mailbox = (oauthProvider: "google" | null) =>
    ({ id: ID, address: "a@x.test", oauthProvider }) as unknown as MailboxView;
  const render = (flag: boolean | undefined, over: { isOwner?: boolean; oauth?: "google" | null } = {}) =>
    renderToStaticMarkup(
      <ModeCard
        mailbox={mailbox(over.oauth ?? null)}
        settings={settings(flag)}
        isOwner={over.isOwner ?? true}
        onChanged={() => undefined}
      />
    );
  const replyTag = (html: string): string => /<button[^>]*id="switch_reply_drafts"[^>]*>/.exec(html)?.[0] ?? "";

  test("the flag off (the key is absent): no row", () => {
    const html = render(undefined);
    expect(html).not.toContain("switch_reply_drafts");
    expect(html).not.toContain(t("rs_switch_help"));
  });

  test("the owner of a password mailbox gets a working switch with the help line", () => {
    const html = render(false);
    expect(replyTag(html)).toContain('aria-checked="false"');
    expect(replyTag(html)).not.toContain('disabled=""');
    expect(html).toContain(t("rs_switch_help"));
    expect(html).not.toContain(t("rs_switch_oauth"));
    expect(render(true)).toContain('aria-checked="true"');
  });

  test("a member, or an OAuth mailbox: the switch is disabled; the OAuth mailbox says why", () => {
    expect(replyTag(render(false, { isOwner: false }))).toContain('disabled=""');
    expect(render(false, { isOwner: false })).not.toContain(t("rs_switch_oauth"));
    const oauth = render(false, { oauth: "google" });
    expect(replyTag(oauth)).toContain('disabled=""');
    expect(oauth).toContain(t("rs_switch_oauth"));
  });
});
