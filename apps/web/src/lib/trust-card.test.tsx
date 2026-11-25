/// <reference types="bun" />
import {
  barCategories,
  type BarCategory,
  type SettingsWebView,
  type TrustCategory,
  type TrustView,
} from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CategoriesCard } from "../components/settings/CategoriesCard";
import { setLocaleForTest, t } from "../i18n";
import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import { blockLines, mailLine, pausedLine, proofLine, refusalBlocks, showRatingsLine, trustLines } from "./trust-card";

afterEach(() => setLocaleForTest("en"));

const MAILBOX = "0190f5a0-0000-7000-8000-000000000003";

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
    file: "classifier-fixture.json",
  },
  history: { outcome: "pass", acted: 60, moved: 0, upper: 0.01, total: 200, wouldMove: 40 },
  trip: { tripped: false, reason: null, at: null },
  realLabels: { kept: 0, precision: null, decision: "no-go: too few" },
  evidence: { eligible: true, recommended: true, blocks: [] },
  ...over,
});

// The three cases of the stage: `notification` eligible, `spam` blocked by the history, `info` tripped.
function view(): TrustView {
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
  categories.urgent = row({
    global: {
      decision: "no-go",
      provisional: false,
      precision: 0.96,
      wilsonLower: 0.928,
      threshold: null,
      cases: 220,
      file: "f",
    },
    history: null,
  });
  categories.needs_reply = row({
    global: {
      decision: "none",
      provisional: false,
      precision: null,
      wilsonLower: null,
      threshold: null,
      cases: 0,
      file: null,
    },
    history: null,
  });
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
    check: {
      status: "done",
      reason: "connect",
      noResultReason: null,
      startedAt: "2026-11-16T11:00:00.000Z",
      finishedAt: "2026-11-16T12:00:00.000Z",
      checked: 200,
      capped: false,
    },
    categories,
    examples: { info: [], notification: [], spam: [] },
  };
}

const settings = (kept = 0): SettingsWebView =>
  ({
    mailboxId: MAILBOX,
    bar: 0.98,
    minKept: 30,
    categories: barCategories.map((category) => ({
      category,
      auto: false,
      threshold: 0.8,
      gate: {
        decision: kept >= 30 ? "go" : "no-go: too few",
        precision: kept >= 30 ? 0.99 : null,
        kept,
        atConfidence: 0.8,
        threshold: 0.8,
      },
    })),
  }) as unknown as SettingsWebView;

function render(trust: TrustView | null, over: { isOwner?: boolean; kept?: number } = {}): string {
  return renderToStaticMarkup(
    <CategoriesCard
      settings={settings(over.kept)}
      trust={trust}
      isOwner={over.isOwner ?? true}
      onChanged={() => undefined}
    />
  );
}

// The markup of one category row: from its `data-slot="row"` div to the next one.
const rowOf = (html: string, category: BarCategory): string => {
  const items = html.split('<div data-slot="row"').slice(1);
  const found = items.find((item) => item.includes(`data-category="${category}"`));
  if (found === undefined) throw new Error(`no row for ${category}`);
  return found;
};
const decode = (html: string): string => html.replaceAll("&gt;", ">").replaceAll("&#x27;", "'");

describe("autonomy card with the trust view (F110 stage 13, test 1)", () => {
  test("notification eligible, spam blocked by the history, info tripped: each row shows its phrases", () => {
    const html = render(view());
    const notification = rowOf(html, "notification");
    expect(notification).toContain("Proof: 99.1% on 200 test cases");
    expect(notification).toContain("Your mail: passed");
    expect(notification).not.toContain("Paused");

    const spam = rowOf(html, "spam");
    expect(spam).toContain("Proof: 99.1% on 200 test cases");
    expect(spam).toContain("Your mail: would hide mail you needed (6 of 60)");
    expect(spam).toContain("text-destructive");

    const info = rowOf(html, "info");
    expect(info).toContain("Paused: you corrected 2 of its moves in 7 days");
    expect(info).toContain('data-line="trust_paused_corrections"');
    // The pause line is the red one.
    expect(/text-destructive[^>]*>Paused/.test(info)).toBe(true);
  });

  test("a non-moving category has no 'Your mail' line; a missing or failing global reads as no proof or not proven", () => {
    const html = render(view());
    expect(rowOf(html, "urgent")).toContain("Not proven (92.8%)");
    expect(rowOf(html, "urgent")).not.toContain("Your mail");
    expect(rowOf(html, "needs_reply")).toContain("No proof for this AI model yet");
  });

  test("the flag off (no view): no evidence line, no report link; the ratings line shows as before", () => {
    const html = render(null);
    for (const text of [en.trust_proof_none, "Proof:", "Your mail", "Paused", en.trust_report_link]) {
      expect(html).not.toContain(text);
    }
    expect(html).toContain(decode(t("gate_too_few", { kept: 0, minKept: 30, at: "0.8" })));
  });

  test("with the view, the ratings line shows only from 30 rated mails", () => {
    expect(render(view(), { kept: 5 })).not.toContain("Not enough rated mails");
    expect(render(view(), { kept: 62 })).toContain("Passed: precision");
    expect(showRatingsLine(29, 30)).toBe(false);
    expect(showRatingsLine(30, 30)).toBe(true);
  });

  test("the report link shows when a check exists, not before", () => {
    expect(render(view())).toContain(`href="/report?mailbox=${MAILBOX}"`);
    expect(render({ ...view(), check: null })).not.toContain("/report?mailbox=");
  });

  test("a member sees the same lines; every switch is disabled", () => {
    const owner = render(view());
    const member = render(view(), { isOwner: false });
    const lines = (html: string): string[] => [...html.matchAll(/data-line="([a-z_]+)"/g)].map((m) => m[1] ?? "");
    expect(lines(member)).toEqual(lines(owner));
    expect(lines(member).length).toBeGreaterThan(5);
    const switches = [...member.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((m) => m[0]);
    expect(switches).toHaveLength(5);
    for (const tag of switches) expect(tag).toContain('disabled=""');
    const ownerSwitches = [...owner.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((m) => m[0]);
    for (const tag of ownerSwitches) expect(tag).not.toContain('disabled=""');
  });

  test("the switch shows what triage reads now (the view), not the stored auto", () => {
    const stored = settings();
    const on = {
      ...stored,
      categories: stored.categories.map((entry) => ({ ...entry, auto: true })),
    } as SettingsWebView;
    const asView = view();
    asView.categories.notification = row({ auto: false });
    const html = renderToStaticMarkup(
      <CategoriesCard settings={on} trust={asView} isOwner onChanged={() => undefined} />
    );
    expect(/aria-checked="false"[^>]*>|<button[^>]*aria-checked="false"/.test(rowOf(html, "notification"))).toBe(true);
    const old = renderToStaticMarkup(<CategoriesCard settings={on} trust={null} isOwner onChanged={() => undefined} />);
    expect(rowOf(old, "notification")).toContain('aria-checked="true"');
  });
});

describe("the line rules", () => {
  test("proof: go, provisional go, none, no-go and too-few", () => {
    const base = row().global;
    expect(proofLine(row())).toMatchObject({ key: "trust_proof_go", vars: { percent: "99.1", cases: 200 } });
    expect(proofLine(row({ global: { ...base, provisional: true } }))).toMatchObject({
      key: "trust_proof_go_provisional",
    });
    expect(proofLine(row({ global: { ...base, decision: "none", wilsonLower: null } })).key).toBe("trust_proof_none");
    expect(proofLine(row({ global: { ...base, decision: "no-go", wilsonLower: 0.9283 } }))).toMatchObject({
      key: "trust_proof_no_go",
      vars: { percent: "92.8" },
    });
    expect(proofLine(row({ global: { ...base, decision: "no-go", provisional: true } })).key).toBe(
      "trust_proof_no_go_provisional"
    );
    expect(proofLine(row({ global: { ...base, decision: "too-few", wilsonLower: null } })).key).toBe(
      "trust_proof_no_go_plain"
    );
    // A global that is not there is never "provisional".
    expect(proofLine(row({ global: { ...base, decision: "none", provisional: true, wilsonLower: null } })).key).toBe(
      "trust_proof_none"
    );
  });

  test("mail line: pass, fail, inconclusive, no result, none yet, and no line for a category that has no history", () => {
    const check = view().check as NonNullable<TrustView["check"]>;
    const hist = (outcome: "pass" | "fail" | "inconclusive" | "no_result") =>
      row({ history: { outcome, acted: 60, moved: 2, upper: 0.1, total: 200, wouldMove: 40 } });
    expect(mailLine("info", hist("pass"), check)?.key).toBe("trust_mail_pass");
    expect(mailLine("info", hist("fail"), check)).toMatchObject({
      key: "trust_mail_fail",
      vars: { moved: 2, acted: 60 },
    });
    expect(mailLine("info", hist("inconclusive"), check)?.key).toBe("trust_mail_unclear");
    expect(mailLine("info", hist("no_result"), check)?.key).toBe("trust_mail_few");
    expect(mailLine("info", row({ history: null }), null)?.key).toBe("trust_mail_unchecked");
    expect(mailLine("info", row({ history: null }), { ...check, status: "classifying" })?.key).toBe(
      "trust_mail_unchecked"
    );
    expect(mailLine("info", row({ history: null }), { ...check, status: "no_result" })?.key).toBe("trust_mail_few");
    expect(mailLine("urgent", row({ history: null }), check)).toBeNull();
  });

  test("paused line: one phrase per reason, none when not tripped", () => {
    const reasons = ["corrections", "important_hidden", "model_switch", "evidence_changed", "history_fail"] as const;
    const keys = reasons.map((reason) => pausedLine(row({ trip: { tripped: true, reason, at: null } }))?.key);
    expect(new Set(keys).size).toBe(5);
    expect(pausedLine(row())).toBeNull();
    expect(trustLines("info", null)).toEqual([]);
  });

  test("block lines: one fixed phrase per block, all different; the history block says what the card says", () => {
    const all = [
      "no_global",
      "global_no_go",
      "global_provisional",
      "history_fail",
      "tripped",
      "real_labels_no_go",
    ] as const;
    const keys = blockLines(all);
    expect(new Set(keys).size).toBe(all.length);
    expect(blockLines([])).toEqual([]);
    expect(t("trust_block_history_fail")).toContain("would hide mail you needed");
  });

  test("refusal blocks: the 409 body wins, even when it is empty; without blocks in the body the view decides", () => {
    expect(refusalBlocks(["history_fail"], ["tripped"])).toEqual(["history_fail"]);
    expect(refusalBlocks([], ["tripped"])).toEqual([]);
    expect(refusalBlocks(undefined, ["tripped"])).toEqual(["tripped"]);
    expect(refusalBlocks(undefined, [])).toEqual([]);
  });

  test("Polish: every new line has a text and the placeholders match English", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("trust_")) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThan(20);
    const slots = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
    for (const key of keys) expect(slots(pl[key])).toEqual(slots(en[key]));
  });
});
