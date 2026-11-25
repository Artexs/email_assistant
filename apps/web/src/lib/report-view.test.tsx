/// <reference types="bun" />
import { barCategories, type BarCategory, type MailboxView, type TrustCategory, type TrustView } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReportContent } from "../components/report/ReportContent";
import { setLocaleForTest, t } from "../i18n";
import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import {
  dueCategories,
  pickReportMailbox,
  recommendationNote,
  reportState,
  shouldPoll,
  showCheckAgain,
  showTurnOn,
} from "./report-view";

afterEach(() => setLocaleForTest("en"));

const MAILBOX = "0190f5a0-0000-7000-8000-000000000003";

// Mail text that must never reach the page: a sender name, a subject and an address, put into the examples of the view.
const SECRET = { fromName: "Zofia Tajna", subject: "Umowa ściśle tajna 2026", address: "zofia.tajna@firma.example" };

const row = (over: Partial<TrustCategory> = {}): TrustCategory => ({
  auto: false,
  grantBy: null,
  global: {
    decision: "go",
    provisional: false,
    precision: 0.995,
    wilsonLower: 0.991,
    threshold: 0.9,
    cases: 200,
    file: "f",
  },
  history: { outcome: "pass", acted: 60, moved: 0, upper: 0.01, total: 200, wouldMove: 40 },
  trip: { tripped: false, reason: null, at: null },
  realLabels: { kept: 0, precision: null, decision: "no-go: too few" },
  evidence: { eligible: true, recommended: true, blocks: [] },
  ...over,
});

type Check = NonNullable<TrustView["check"]>;
const doneCheck: Check = {
  status: "done",
  reason: "connect",
  noResultReason: null,
  startedAt: "2026-11-16T11:00:00.000Z",
  finishedAt: "2026-11-16T12:00:00.000Z",
  checked: 200,
  capped: false,
};

// `notification` recommended, `spam` failed by the history, `info` paused; the examples hold mail text.
function view(over: Partial<TrustView> = {}): TrustView {
  const categories = Object.fromEntries(barCategories.map((category) => [category, row()])) as Record<
    BarCategory,
    TrustCategory
  >;
  categories.spam = row({
    history: { outcome: "fail", acted: 60, moved: 6, upper: 0.2, total: 200, wouldMove: 40 },
    evidence: { eligible: false, recommended: false, blocks: ["history_fail"] },
  });
  categories.info = row({
    trip: { tripped: true, reason: "corrections", at: "2026-11-10T10:00:00.000Z" },
    evidence: { eligible: true, recommended: false, blocks: ["tripped"] },
  });
  const example = {
    emailId: "0190f5a0-0000-7000-8000-0000000000aa",
    receivedAt: "2026-11-15T10:00:00.000Z",
    fromName: SECRET.fromName,
    subject: SECRET.subject,
  };
  return {
    mailboxId: MAILBOX,
    flag: true,
    key: {
      provider: "openai",
      model: "m",
      reasoningEffort: null,
      promptVersion: "classifier-v2",
      promptParts: null,
      endpoint: "standard",
      host: null,
    },
    mode: "assist",
    check: doneCheck,
    categories,
    examples: { info: [example], notification: [example], spam: [example, example, example] },
    ...over,
  };
}

const withCheck = (over: Partial<Check>): TrustView => view({ check: { ...doneCheck, ...over } });

function html(
  v: TrustView,
  over: {
    isOwner?: boolean;
    turnedOn?: Parameters<typeof ReportContent>[0]["turnedOn"];
    reviewHref?: string | null;
  } = {}
): string {
  return renderToStaticMarkup(
    <ReportContent
      view={v}
      isOwner={over.isOwner ?? true}
      pending={false}
      turnedOn={over.turnedOn ?? null}
      reviewHref={over.reviewHref ?? null}
      onTurnOn={() => undefined}
      onCheckAgain={() => undefined}
    />
  );
}

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("reportState", () => {
  test("no check, an open check, a no_result with its reason, and a done check", () => {
    expect(reportState(view({ check: null }))).toEqual({ kind: "starting" });
    for (const status of ["queued", "backfilling", "waiting_flags", "classifying"] as const) {
      expect(reportState(withCheck({ status, checked: 12 }))).toEqual({ kind: "running", checked: 12 });
    }
    expect(reportState(withCheck({ status: "no_result", noResultReason: "no_history" }))).toEqual({
      kind: "no_result",
      reasonKey: "rep_nr_no_history",
    });
    expect(reportState(view())).toEqual({ kind: "done", capped: false });
  });

  test("every no_result reason has its own sentence, in both languages", () => {
    const reasons = [
      "no_history",
      "uidvalidity",
      "cost_unknown",
      "stopped",
      "key_changed",
      "auth_refused",
      "model_failing",
    ] as const;
    const keys = reasons.map((noResultReason) => {
      const state = reportState(withCheck({ status: "no_result", noResultReason }));
      if (state.kind !== "no_result") throw new Error("not a no_result state");
      return state.reasonKey;
    });
    expect(new Set(keys).size).toBe(reasons.length);
    for (const key of keys) {
      expect(en[key]).toContain("The test results alone decide.");
      expect(pl[key]).toContain("Decydują same wyniki testów.");
    }
  });

  test("polling runs while the check is open or absent, and stops in an end state", () => {
    expect(shouldPoll(null)).toBe(true);
    expect(shouldPoll(view({ check: null }))).toBe(true);
    expect(shouldPoll(withCheck({ status: "classifying" }))).toBe(true);
    expect(shouldPoll(view())).toBe(false);
    expect(shouldPoll(withCheck({ status: "no_result", noResultReason: "stopped" }))).toBe(false);
  });
});

describe("what is due", () => {
  test("recommended and not on: only `notification` here; a category that is on is not due", () => {
    expect(dueCategories(view())).toEqual(["notification"]);
    const on = view();
    on.categories.notification = row({ auto: true });
    expect(dueCategories(on)).toEqual([]);
    expect(recommendationNote(on)).toBe("all_on");
  });

  test("nothing recommended gives the note `none`", () => {
    const v = view();
    v.categories.notification = row({ evidence: { eligible: false, recommended: false, blocks: ["no_global"] } });
    expect(dueCategories(v)).toEqual([]);
    expect(recommendationNote(v)).toBe("none");
    expect(recommendationNote(view())).toBeNull();
  });

  test("the button is for an owner, in an end state, with something due", () => {
    expect(showTurnOn(view(), true)).toBe(true);
    expect(showTurnOn(view(), false)).toBe(false);
    expect(showTurnOn(withCheck({ status: "no_result", noResultReason: "no_history" }), true)).toBe(true);
    expect(showTurnOn(withCheck({ status: "classifying" }), true)).toBe(false);
    expect(showTurnOn(view({ check: null }), true)).toBe(false);
  });

  test("Check again is for an owner in an end state only", () => {
    expect(showCheckAgain(view(), true)).toBe(true);
    expect(showCheckAgain(view(), false)).toBe(false);
    expect(showCheckAgain(withCheck({ status: "backfilling" }), true)).toBe(false);
    expect(showCheckAgain(view({ check: null }), true)).toBe(false);
  });
});

describe("pickReportMailbox", () => {
  const mailbox = (id: string, createdAt: string) => ({ id, createdAt }) as MailboxView;
  const list = [
    mailbox("a", "2026-01-01T00:00:00.000Z"),
    mailbox("c", "2026-03-01T00:00:00.000Z"),
    mailbox("b", "2026-02-01T00:00:00.000Z"),
  ];

  test("the listed id of the query wins, else the newest connected mailbox", () => {
    expect(pickReportMailbox(list, "a")?.id).toBe("a");
    expect(pickReportMailbox(list, null)?.id).toBe("c");
    expect(pickReportMailbox(list, "not-listed")?.id).toBe("c");
    expect(pickReportMailbox([], null)).toBeNull();
  });
});

describe("the report content", () => {
  test("done: counts and fixed phrases per category, the button names the due category, and it states the read-only check", () => {
    const markup = text(html(view()));
    expect(markup).toContain(t("rep_checked", { checked: 200 }));
    expect(markup).toContain(t("rep_counts", { total: 200, wouldMove: 40 }));
    expect(markup).toContain(t("trust_proof_go", { percent: "99.1", cases: 200 }));
    expect(markup).toContain(t("trust_mail_fail", { moved: 6, acted: 60 }));
    expect(markup).toContain(en.trust_paused_corrections);
    expect(markup).toContain(t("rep_turn_on", { categories: en.cat_notification }));
    expect(markup).toContain(en.rep_read_only);
    expect(markup).toContain(en.rep_check_again);
    // The suggestion of the panel review is hidden while the flag `panel_review` is off (no href).
    expect(markup).not.toContain(en.rep_review_suggest);
  });

  test("each category is a card with its pill, its status badge and a ring named by the counts; no history gives no ring", () => {
    const v = view();
    v.categories.notification = row({
      history: { outcome: "pass", acted: 20, moved: 0, upper: 0.02, total: 40, wouldMove: 12 },
    });
    v.categories.spam = row({
      history: null,
      evidence: { eligible: false, recommended: false, blocks: ["no_global"] },
    });
    const cards = html(v).split("<article").slice(1);
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(card.split('data-slot="category-pill"')).toHaveLength(2);
    const [info, notification, spam] = cards;
    expect(notification).toContain(`aria-label="${t("rep_counts", { total: 40, wouldMove: 12 })}"`);
    expect(notification).toContain('data-status="rep_recommended"');
    expect(info).toContain('role="img"');
    expect(spam).not.toContain('role="img"');
    expect(spam).not.toContain("Mails checked");
  });

  test("no card has a button: the one turn-on button and Check again sit in the action card", () => {
    const markup = html(view());
    const cards = markup.slice(markup.indexOf("<article"), markup.lastIndexOf("</article>"));
    expect(cards).not.toContain("<button");
    expect(markup.split("<button")).toHaveLength(3);
    expect(markup.split(`>${t("rep_turn_on", { categories: en.cat_notification })}<`)).toHaveLength(2);
  });

  test("with the flag on the optional review link shows under the categories, never as a button or a required step", () => {
    const href = `/review?mailbox=${MAILBOX}`;
    const markup = html(view(), { reviewHref: href });
    expect(text(markup)).toContain(en.rep_review_suggest);
    expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain(en.rep_review_link);
    // A running check has no categories yet: no suggestion.
    expect(html(withCheck({ status: "classifying" }), { reviewHref: href })).not.toContain(en.rep_review_suggest);
  });

  test("a member sees the text and no button", () => {
    const markup = html(view(), { isOwner: false });
    expect(markup).not.toContain("<button");
    expect(text(markup)).toContain(en.rep_owner_only);
    expect(text(markup)).toContain(t("rep_counts", { total: 200, wouldMove: 40 }));
  });

  test("a running check shows the progress and nothing else of the result", () => {
    const markup = html(withCheck({ status: "classifying", checked: 40 }));
    expect(text(markup)).toContain(t("rep_progress", { checked: 40, max: 500 }));
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("data-category");
  });

  test("no check yet: the starting text", () => {
    expect(text(html(view({ check: null })))).toContain(en.rep_starting);
  });

  test("no_result: the sentence of the reason, the recommendation part and the button", () => {
    const markup = text(html(withCheck({ status: "no_result", noResultReason: "uidvalidity" })));
    expect(markup).toContain(en.rep_nr_uidvalidity);
    expect(markup).toContain(t("rep_turn_on", { categories: en.cat_notification }));
  });

  test("done with no checked mail of the user's own: no summary line beside the counts of the cards", () => {
    const markup = html(withCheck({ ...doneCheck, checked: 0 }));
    expect(markup).not.toContain('data-report="summary"');
    expect(markup).toContain(t("rep_counts", { total: 200, wouldMove: 40 }));
  });

  test("nothing recommended: no button and the sentence why", () => {
    const v = view();
    v.categories.notification = row({ evidence: { eligible: false, recommended: false, blocks: ["no_global"] } });
    const markup = html(v);
    expect(text(markup)).toContain(en.rep_nothing);
    expect(markup).not.toContain(en.rep_turn_on.split("(")[0]?.trim() ?? "?");
  });

  test("after the tap that turned the last categories on: the result line and no amber already-on note", () => {
    const v = view();
    v.categories.notification = row({ auto: true, evidence: { eligible: true, recommended: true, blocks: [] } });
    const after = text(html(v, { turnedOn: { categories: ["notification"], mode: "assist" } }));
    expect(after).toContain(t("rep_turned_on", { categories: en.cat_notification }));
    expect(after).not.toContain(en.rep_all_on);
  });

  test("after the tap: the categories turned on and the new mode", () => {
    const markup = text(html(view(), { turnedOn: { categories: ["notification"], mode: "assist" } }));
    expect(markup).toContain(`${t("rep_turned_on", { categories: en.cat_notification })} ${en.rep_mode_assist}`);
  });

  test("polish: the page renders the Polish phrases", () => {
    setLocaleForTest("pl");
    const markup = text(html(view()));
    expect(markup).toContain(t("rep_turn_on", { categories: pl.cat_notification }));
    expect(markup).toContain(pl.rep_read_only);
  });

  // The page shows counts and fixed phrases only: the view carries example mails for the panel review, and none of
  // their text may reach the markup, in any state, for an owner or a member, in English or Polish.
  test("no mail text: the sender name, the subject and the address of the examples never show, in any state", () => {
    const states: TrustView[] = [
      view(),
      view({ check: null }),
      withCheck({ status: "classifying", checked: 3 }),
      withCheck({ status: "no_result", noResultReason: "no_history" }),
      withCheck({ capped: true }),
    ];
    for (const locale of ["en", "pl"] as const) {
      setLocaleForTest(locale);
      for (const v of states) {
        for (const isOwner of [true, false]) {
          const markup = html(v, { isOwner, turnedOn: { categories: ["notification"], mode: "assist" } });
          for (const secret of Object.values(SECRET)) expect(markup).not.toContain(secret);
          expect(markup).not.toContain("@");
        }
      }
    }
  });
});
