/// <reference types="bun" />
import type { NewsletterItem } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { NewsletterRows } from "../components/rules/NewslettersCard";
import { setLocaleForTest, t, tp } from "../i18n";

import { ApiError } from "./api";
import { actionOf, safeLink, unsubscribeFailureKey, unsubscribePath } from "./newsletters-view";

const NOW = new Date("2026-11-18T12:00:00Z");
const base = {
  fromName: null,
  count: 3,
  latestAt: "2026-11-17T08:00:00.000Z",
  request: null,
} as const;
const item = (over: Partial<NewsletterItem> & Pick<NewsletterItem, "senderLower" | "method">): NewsletterItem => ({
  ...base,
  ...over,
});

function render(senders: NewsletterItem[], canTap = false): string {
  return renderToStaticMarkup(
    <NewsletterRows senders={senders} timeZone="Europe/Warsaw" now={NOW} canTap={canTap} mailboxId="m1" />
  );
}

describe("safeLink", () => {
  test("only an https URL with a host and no credentials is offered", () => {
    expect(safeLink("https://u.c.example/x?a=1")).toEqual({ href: "https://u.c.example/x?a=1", host: "u.c.example" });
    for (const bad of [
      undefined,
      "http://u.c.example/x",
      "javascript:alert(1)",
      "mailto:a@c.example",
      "https://user:pw@u.c.example/x",
      "not a url",
    ]) {
      expect(safeLink(bad)).toBeNull();
    }
  });
});

describe("actionOf", () => {
  test("a link item opens the page; a one-click item opens it only after a request; none is text", () => {
    const link = "https://u.c.example/x";
    expect(actionOf(item({ senderLower: "a@c.example", method: "link", linkUrl: link }))).toMatchObject({
      kind: "open",
    });
    expect(actionOf(item({ senderLower: "a@c.example", method: "link" }))).toEqual({ kind: "wait" });
    expect(actionOf(item({ senderLower: "a@c.example", method: "one_click" }))).toEqual({ kind: "wait" });
    expect(
      actionOf(
        item({
          senderLower: "a@c.example",
          method: "one_click",
          linkUrl: link,
          request: { status: "failed", at: "2026-11-18T10:00:00.000Z", code: "timeout" },
        })
      )
    ).toMatchObject({ kind: "open" });
    expect(actionOf(item({ senderLower: "a@c.example", method: "none" }))).toEqual({ kind: "none" });
    // A link that the server should not send for the state of the row is not shown.
    expect(actionOf(item({ senderLower: "a@c.example", method: "one_click", linkUrl: link }))).toEqual({
      kind: "wait",
    });
    expect(actionOf(item({ senderLower: "a@c.example", method: "none", linkUrl: link }))).toEqual({ kind: "none" });
  });
});

describe("NewsletterRows", () => {
  setLocaleForTest("en");

  test("a link row has a new-tab link with noopener noreferrer; a none row says so; the address is the identity", () => {
    const html = render([
      item({ senderLower: "link@c.example", method: "link", linkUrl: "https://u.c.example/x", fromName: "Link News" }),
      item({ senderLower: "none@c.example", method: "none" }),
      item({ senderLower: "one@c.example", method: "one_click" }),
    ]);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://u.c.example/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(t("nl_open_link"));
    expect(html).toContain(t("nl_none"));
    expect(html).toContain("link@c.example");
    expect(html).toContain(tp("nl_count", 3));
    expect(html.match(/data-method="/g)).toHaveLength(3);
    expect(html).not.toContain("<button");
  });

  test("the display name and a hostile link are text or absent: markup in a name is escaped; a javascript: link has no anchor", () => {
    const html = render([
      item({
        senderLower: "a@c.example",
        method: "link",
        linkUrl: "javascript:alert(1)",
        fromName: "<img src=x onerror=1>",
      }),
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("javascript:");
  });

  test("the state of a request shows: Requested, Done, and Failed with the page link or without", () => {
    const at = "2026-11-18T10:00:00.000Z";
    const link = "https://u.c.example/x";
    const rows = (status: "requested" | "done" | "failed" | "refused", linkUrl?: string) =>
      render([
        item({
          senderLower: "a@c.example",
          method: "one_click",
          request: { status, at, code: status === "requested" ? null : "http_500" },
          ...(linkUrl === undefined ? {} : { linkUrl }),
        }),
      ]);
    expect(rows("requested")).toContain(t("nl_requested"));
    expect(rows("done")).toContain(t("nl_done"));
    expect(rows("failed", link)).toContain(t("nl_failed_open"));
    expect(rows("refused", link)).toContain('href="https://u.c.example/x"');
    const noLink = rows("failed");
    expect(noLink).toContain(t("nl_failed"));
    expect(noLink).not.toContain(t("nl_failed_open"));
    expect(noLink).not.toContain("<a ");
  });

  test("an empty list says so", () => {
    expect(render([])).toContain(t("nl_empty"));
  });
});

describe("newsletter texts", () => {
  test("Polish counts use one, few and many", () => {
    setLocaleForTest("pl");
    expect(tp("nl_count", 1)).toBe("1 e-mail w ciągu 30 dni");
    expect(tp("nl_count", 3)).toBe("3 e-maile w ciągu 30 dni");
    expect(tp("nl_count", 12)).toBe("12 e-maili w ciągu 30 dni");
    expect(t("nl_failed_open")).toBe("Nie udało się — otwórz stronę wypisania");
    setLocaleForTest("en");
  });
});

// The one-click button.
describe("the unsubscribe button", () => {
  setLocaleForTest("en");
  const link = "https://u.c.example/x";
  const at = "2026-11-18T10:00:00.000Z";

  test("actionOf: only an owner who can tap gets the button, only for a one-click row with no request", () => {
    const one = item({ senderLower: "a@c.example", method: "one_click" });
    expect(actionOf(one, true)).toEqual({ kind: "unsubscribe" });
    expect(actionOf(one, false)).toEqual({ kind: "wait" });
    expect(actionOf(one)).toEqual({ kind: "wait" });
    for (const status of ["requested", "done", "failed", "refused"] as const) {
      const sent = item({ senderLower: "a@c.example", method: "one_click", request: { status, at, code: null } });
      expect(actionOf(sent, true).kind).not.toBe("unsubscribe");
    }
    expect(actionOf(item({ senderLower: "a@c.example", method: "link", linkUrl: link }), true).kind).toBe("open");
    expect(actionOf(item({ senderLower: "a@c.example", method: "none" }), true)).toEqual({ kind: "none" });
  });

  test("the owner sees one button per one-click row with no request, named by the address; a member and a request row see none", () => {
    const rows = [
      item({ senderLower: "one@c.example", method: "one_click" }),
      item({ senderLower: "done@c.example", method: "one_click", request: { status: "done", at, code: "http_200" } }),
      item({ senderLower: "link@c.example", method: "link", linkUrl: link }),
    ];
    const owner = render(rows, true);
    expect(owner.match(/<button/g)).toHaveLength(1);
    expect(owner).toContain(`aria-label="${t("nl_unsubscribe_for", { sender: "one@c.example" })}"`);
    expect(owner).toContain(t("nl_unsubscribe"));
    expect(render(rows, false)).not.toContain("<button");
  });

  test("a one-click row has the button named by its sender inside the row; a member row of the same sender has none", () => {
    const rows = [item({ senderLower: "one@c.example", method: "one_click" })];
    const owner = render(rows, true);
    expect(owner).toMatch(/data-sender="one@c.example"[^]*<button[^>]*aria-label="Unsubscribe from one@c.example"/);
    expect(owner).toContain('data-method="one_click"');
    expect(render(rows, false)).not.toContain("<button");
  });

  test("the result code shows next to the state; a refused request says nothing was sent", () => {
    const html = render([
      item({ senderLower: "a@c.example", method: "one_click", request: { status: "failed", at, code: "timeout" } }),
      item({
        senderLower: "b@c.example",
        method: "one_click",
        request: { status: "refused", at, code: "private_host" },
      }),
      item({ senderLower: "c@c.example", method: "one_click", request: { status: "requested", at, code: null } }),
    ]);
    expect(html).toContain(t("nl_code", { code: "timeout" }));
    expect(html).toContain(t("nl_code", { code: "private_host" }));
    expect(html).toContain(t("nl_refused"));
    expect(html.match(/Result:/g)).toHaveLength(2);
  });

  test("the path and the failure texts: 429, another 409, a second tap (no toast) and a failed send", () => {
    expect(unsubscribePath("m1")).toBe("/api/newsletters/m1/unsubscribe");
    expect(unsubscribeFailureKey(new ApiError(429, "rate_limited"))).toBe("nl_err_rate");
    expect(unsubscribeFailureKey(new ApiError(409, "not_allowed"))).toBe("nl_err_not_allowed");
    expect(unsubscribeFailureKey(new ApiError(409, "no_one_click"))).toBe("nl_err_not_allowed");
    expect(unsubscribeFailureKey(new ApiError(409, "already_requested"))).toBeNull();
    expect(unsubscribeFailureKey(new ApiError(500, "internal"))).toBe("nl_err_send");
    expect(unsubscribeFailureKey(new TypeError("network"))).toBe("nl_err_send");
  });

  test("Polish texts exist for every new key", () => {
    setLocaleForTest("pl");
    expect(t("nl_unsubscribe")).toBe("Wypisz");
    expect(t("nl_unsubscribe_for", { sender: "a@c.example" })).toBe("Wypisz z listy a@c.example");
    expect(t("nl_code", { code: "timeout" })).toBe("Wynik: timeout");
    setLocaleForTest("en");
  });
});
