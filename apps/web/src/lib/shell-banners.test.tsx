/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthErrorBanner } from "../components/shell/AuthErrorBanner";
import { PausedBanner } from "../components/shell/PausedBanner";
import { setLocaleForTest, t, tp } from "../i18n";

describe("AuthErrorBanner", () => {
  test("two mailboxes: a status box with the plural text, the mailboxes link and the warm fill", () => {
    setLocaleForTest("en");
    const html = renderToStaticMarkup(<AuthErrorBanner count={2} />);
    expect(html).toContain('role="status"');
    expect(html).toContain(tp("auth_error_banner", 2));
    expect(html).toContain('href="/mailboxes"');
    expect(html).toContain(t("auth_error_banner_link"));
    expect(html).toContain("bg-accent");
    expect(html).toContain('aria-hidden="true"');
  });

  test("no mailbox in error: nothing is rendered", () => {
    expect(renderToStaticMarkup(<AuthErrorBanner count={0} />)).toBe("");
  });
});

describe("PausedBanner", () => {
  test.each([
    { contact: null, text: () => t("paused_banner_no_contact") },
    { contact: "ops@example.com", text: () => t("paused_banner", { contact: "ops@example.com" }) },
  ])("contact $contact: a status box with its text and the destructive fill", ({ contact, text }) => {
    setLocaleForTest("en");
    const html = renderToStaticMarkup(<PausedBanner contact={contact} />);
    expect(html).toContain('role="status"');
    expect(html).toContain(text());
    expect(html).toContain("bg-destructive-soft");
  });
});
