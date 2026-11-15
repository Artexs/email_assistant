import { URGENCY_MAX_ITEMS, urgencyProfileSchema } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import {
  canAddDeadline,
  canAddTopic,
  draftFromProfile,
  isEnded,
  profileFromDraft,
  splitKeywords,
  type UrgencyDraft,
} from "./urgency-form";

const draft = (patch: Partial<UrgencyDraft> = {}): UrgencyDraft => ({ topics: [], deadlines: [], ...patch });

describe("splitKeywords", () => {
  test("splits on commas, trims and drops empty pieces", () => {
    expect(splitKeywords(" audit , tax,, ,  ")).toEqual(["audit", "tax"]);
    expect(splitKeywords("")).toEqual([]);
  });

  test("drops a repeated keyword, ignoring case, and keeps the first spelling", () => {
    expect(splitKeywords("a, a, A")).toEqual(["a"]);
    expect(splitKeywords("Audit, tax, AUDIT, Tax ,x")).toEqual(["Audit", "tax", "x"]);
  });
});

describe("draftFromProfile", () => {
  test("a null profile is an empty draft; keywords join with a comma and a space", () => {
    expect(draftFromProfile(null)).toEqual({ topics: [], deadlines: [] });
    expect(
      draftFromProfile({
        topics: [{ label: "Audit", keywords: ["audit", "tax"] }],
        deadlines: [{ label: "Filing", due: "2026-12-01" }],
      })
    ).toEqual({
      topics: [{ label: "Audit", keywords: "audit, tax" }],
      deadlines: [{ label: "Filing", due: "2026-12-01" }],
    });
  });
});

describe("profileFromDraft", () => {
  test("a valid draft gives the profile the server schema accepts", () => {
    const result = profileFromDraft(
      draft({
        topics: [{ label: " Audit ", keywords: "audit, tax" }],
        deadlines: [{ label: "Filing", due: "2026-12-01" }],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toEqual({
      topics: [{ label: "Audit", keywords: ["audit", "tax"] }],
      deadlines: [{ label: "Filing", due: "2026-12-01" }],
    });
    expect(urgencyProfileSchema.safeParse(result.profile).success).toBe(true);
  });

  test("an empty draft sends null (the server stores an empty profile as null)", () => {
    expect(profileFromDraft(draft())).toEqual({ ok: true, profile: null });
  });

  test("a label of 81 characters is refused with the row number; 80 passes", () => {
    const refused = profileFromDraft(draft({ topics: [{ label: "x".repeat(81), keywords: "" }] }));
    expect(refused).toEqual({ ok: false, error: { key: "urg_err_topic_label", n: 1 } });
    expect(profileFromDraft(draft({ topics: [{ label: "x".repeat(80), keywords: "" }] })).ok).toBe(true);
    const deadline = profileFromDraft(
      draft({
        deadlines: [
          { label: "ok", due: "2026-12-01" },
          { label: "x".repeat(81), due: "2026-12-01" },
        ],
      })
    );
    expect(deadline).toEqual({ ok: false, error: { key: "urg_err_deadline_label", n: 2 } });
  });

  test("an empty label is refused", () => {
    expect(profileFromDraft(draft({ topics: [{ label: "  ", keywords: "" }] }))).toEqual({
      ok: false,
      error: { key: "urg_err_topic_label", n: 1 },
    });
  });

  test("keywords: 11 are too many, 41 characters are too long, 10 of 40 pass", () => {
    const many = Array.from({ length: 11 }, (_, i) => `k${i}`).join(",");
    expect(profileFromDraft(draft({ topics: [{ label: "a", keywords: many }] }))).toEqual({
      ok: false,
      error: { key: "urg_err_keywords_many", n: 1 },
    });
    expect(profileFromDraft(draft({ topics: [{ label: "a", keywords: `ok,${"k".repeat(41)}` }] }))).toEqual({
      ok: false,
      error: { key: "urg_err_keyword", n: 1 },
    });
    const ten = Array.from({ length: 10 }, () => "k".repeat(40)).join(",");
    expect(profileFromDraft(draft({ topics: [{ label: "a", keywords: ten }] })).ok).toBe(true);
  });

  test("a NUL character in a label or a keyword gives the text error of its row", () => {
    expect(profileFromDraft(draft({ topics: [{ label: "a\u0000b", keywords: "" }] }))).toEqual({
      ok: false,
      error: { key: "urg_err_topic_nul", n: 1 },
    });
    expect(
      profileFromDraft(
        draft({
          topics: [
            { label: "ok", keywords: "x" },
            { label: "ok", keywords: "y, z\u0000" },
          ],
        })
      )
    ).toEqual({ ok: false, error: { key: "urg_err_topic_nul", n: 2 } });
    expect(profileFromDraft(draft({ deadlines: [{ label: "d\u0000", due: "2026-12-01" }] }))).toEqual({
      ok: false,
      error: { key: "urg_err_deadline_nul", n: 1 },
    });
  });

  test("a deadline needs a real date", () => {
    for (const due of ["", "2026-13-01", "2026-02-30", "tomorrow"]) {
      expect(profileFromDraft(draft({ deadlines: [{ label: "a", due }] }))).toEqual({
        ok: false,
        error: { key: "urg_err_deadline_date", n: 1 },
      });
    }
  });

  test("more than URGENCY_MAX_ITEMS topics or deadlines are refused as a list error", () => {
    const topics = Array.from({ length: URGENCY_MAX_ITEMS + 1 }, (_, i) => ({ label: `t${i}`, keywords: "" }));
    expect(profileFromDraft(draft({ topics }))).toEqual({ ok: false, error: { key: "urg_err_topics_many", n: 0 } });
    const deadlines = Array.from({ length: URGENCY_MAX_ITEMS + 1 }, (_, i) => ({ label: `d${i}`, due: "2026-12-01" }));
    expect(profileFromDraft(draft({ deadlines }))).toEqual({
      ok: false,
      error: { key: "urg_err_deadlines_many", n: 0 },
    });
    expect(profileFromDraft(draft({ topics: topics.slice(0, URGENCY_MAX_ITEMS) })).ok).toBe(true);
  });
});

describe("canAdd", () => {
  test("the add buttons stop at URGENCY_MAX_ITEMS", () => {
    const topics = Array.from({ length: URGENCY_MAX_ITEMS }, () => ({ label: "a", keywords: "" }));
    const deadlines = Array.from({ length: URGENCY_MAX_ITEMS }, () => ({ label: "a", due: "2026-12-01" }));
    expect(canAddTopic(draft({ topics: topics.slice(1) }))).toBe(true);
    expect(canAddTopic(draft({ topics }))).toBe(false);
    expect(canAddDeadline(draft({ deadlines: deadlines.slice(1) }))).toBe(true);
    expect(canAddDeadline(draft({ deadlines }))).toBe(false);
  });
});

describe("isEnded", () => {
  const warsaw = "Europe/Warsaw";
  test("a date before the local date has ended; today has not", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    expect(isEnded("2026-11-14", now, warsaw)).toBe(true);
    expect(isEnded("2026-11-15", now, warsaw)).toBe(false);
    expect(isEnded("2026-11-16", now, warsaw)).toBe(false);
  });

  test("the local date of the organization decides, not the UTC date", () => {
    // 23:30 UTC on 14 November is 00:30 on 15 November in Warsaw: 14 November has ended there.
    const now = new Date("2026-11-14T23:30:00Z");
    expect(isEnded("2026-11-14", now, warsaw)).toBe(true);
    expect(isEnded("2026-11-14", now, "UTC")).toBe(false);
  });

  test("an unfinished date never counts as ended", () => {
    expect(isEnded("", new Date("2026-11-15T12:00:00Z"), warsaw)).toBe(false);
  });
});
