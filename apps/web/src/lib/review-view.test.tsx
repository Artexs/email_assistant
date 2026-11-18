/// <reference types="bun" />
import { reviewLabelCategories, type PanelReviewItem, type PanelReviewSample } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReviewContent, type ReviewContentProps } from "../components/review/ReviewContent";
import { setLocaleForTest, t } from "../i18n";
import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import { reviewPath, reviewSamplePath } from "./review-api";
import { canConfirm, pickCategories, reviewFinished } from "./review-view";

afterEach(() => setLocaleForTest("en"));

const MAILBOX = "0190f5a0-0000-7000-8000-000000000003";
const NOW = new Date("2026-11-20T12:00:00Z");

const item = (n: number, over: Partial<PanelReviewItem> = {}): PanelReviewItem => ({
  emailId: `0190f5a0-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`,
  receivedAt: "2026-11-19T09:30:00.000Z",
  fromName: `Zofia Nowak ${n}`,
  subject: `Umowa numer ${n}`,
  category: "info",
  confidence: 0.87,
  aiText: `Krótkie podsumowanie ${n}.`,
  ...over,
});

const sample = (items: PanelReviewItem[], delegation = false): PanelReviewSample => ({ items, delegation });

function html(over: Partial<ReviewContentProps> & { sample: PanelReviewSample }): string {
  return renderToStaticMarkup(
    <ReviewContent
      answers={{}}
      busy={false}
      doneTapped={false}
      timeZone="Europe/Warsaw"
      now={NOW}
      backHref={`/report?mailbox=${MAILBOX}`}
      onRight={() => undefined}
      onPick={() => undefined}
      onDone={() => undefined}
      {...over}
    />
  );
}

describe("the review rules", () => {
  test("`Right` is not offered for a mail the assistant could not place", () => {
    expect(canConfirm(item(1))).toBe(true);
    expect(canConfirm(item(1, { category: "unsure" }))).toBe(false);
  });

  test("`delegation` is in the select only with an active delegate, or on a mail that already is one", () => {
    const without = pickCategories(sample([item(1)]), item(1));
    expect(without).not.toContain("delegation");
    expect(without).toEqual(reviewLabelCategories.filter((category) => category !== "delegation"));
    expect(pickCategories(sample([item(1)], true), item(1))).toContain("delegation");
    expect(
      pickCategories(sample([item(2, { category: "delegation" })]), item(2, { category: "delegation" }))
    ).toContain("delegation");
  });

  test("the thank-you shows when the last item is answered or on `Done`, and never for an empty sample alone", () => {
    expect(reviewFinished(10, 9, false)).toBe(false);
    expect(reviewFinished(10, 10, false)).toBe(true);
    expect(reviewFinished(10, 3, true)).toBe(true);
    expect(reviewFinished(0, 0, false)).toBe(false);
  });

  test("the paths carry the mailbox id", () => {
    expect(reviewPath(MAILBOX)).toBe(`/review?mailbox=${MAILBOX}`);
    expect(reviewSamplePath(MAILBOX)).toBe(`/api/review/sample?mailboxId=${MAILBOX}`);
  });
});

describe("the review content", () => {
  test("each open item shows its text, `Right`, a category select with a label and a save button; `Done` is there", () => {
    const markup = html({ sample: sample([item(1), item(2)]) });
    expect(markup).toContain("Zofia Nowak 1");
    expect(markup).toContain("Umowa numer 2");
    expect(markup).toContain("Krótkie podsumowanie 1.");
    expect(markup).toContain(t("rv_sure", { value: 87 }));
    expect(markup.split(en.rv_right).length - 1).toBe(2);
    expect(markup.split("<select").length - 1).toBe(2);
    // Each select has a visible label that points at it.
    expect(markup).toContain(`for="rv-pick-${item(1).emailId}"`);
    expect(markup).toContain(`id="rv-pick-${item(1).emailId}"`);
    expect(markup).toContain(en.rv_done);
    expect(markup).toContain(t("rv_progress", { answered: 0, total: 2 }));
    expect(markup).not.toContain(en.rv_thanks);
  });

  test("an unsure item has no `Right`; an answered item shows its answer and no buttons", () => {
    const unsure = html({ sample: sample([item(1, { category: "unsure" })]) });
    expect(unsure).not.toContain(en.rv_right);
    expect(unsure).toContain("<select");
    const answered = html({
      sample: sample([item(1), item(2)]),
      answers: { [item(1).emailId]: t("act_toast_same") },
    });
    expect(answered).toContain(t("act_toast_same"));
    expect(answered.split(en.rv_right).length - 1).toBe(1);
    expect(answered).toContain(t("rv_progress", { answered: 1, total: 2 }));
  });

  test("after the last answer, the thank-you and the link back show and no control is left", () => {
    const items = [item(1), item(2)];
    const answers = Object.fromEntries(items.map((entry) => [entry.emailId, "ok"]));
    const markup = html({ sample: sample(items), answers });
    expect(markup).toContain(en.rv_thanks);
    expect(markup).toContain(`href="/report?mailbox=${MAILBOX}"`);
    expect(markup).toContain(en.rv_back);
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain(en.rv_done);
  });

  test("`Done` locks the open items and shows the thank-you", () => {
    const markup = html({ sample: sample([item(1), item(2)]), doneTapped: true });
    expect(markup).toContain(en.rv_thanks);
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain(en.rv_right);
  });

  test("an empty sample says so and links back; no thank-you", () => {
    const markup = html({ sample: sample([]) });
    expect(markup).toContain(en.rv_empty);
    expect(markup).toContain(en.rv_back);
    expect(markup).not.toContain(en.rv_thanks);
    expect(markup).not.toContain(en.rv_done);
  });

  test("a busy page (a write in flight, or a paused organization) turns the buttons off", () => {
    const markup = html({ sample: sample([item(1)]), busy: true });
    expect(markup).toContain("disabled");
    expect(markup.match(/<button[^>]*disabled=""/g)?.length).toBe(2);
    expect(markup).toMatch(/<select[^>]*disabled=""/);
  });

  test("mail text is printed as plain text: markup in a subject is escaped", () => {
    const markup = html({
      sample: sample([item(1, { subject: "<img src=x onerror=alert(1)>", fromName: "<b>Bold</b>" })]),
    });
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<b>Bold");
    expect(markup).toContain("&lt;img src=x");
  });

  test("Polish: the same page in Polish uses the Polish keys, with no English leftover", () => {
    setLocaleForTest("pl");
    const markup = html({ sample: sample([item(1)]) });
    expect(markup).toContain(pl.rv_right);
    expect(markup).toContain(pl.rv_pick_label);
    expect(markup).toContain(pl.rv_intro);
    expect(markup).not.toContain(en.rv_right);
    expect(markup).not.toContain(en.rv_intro);
  });
});
