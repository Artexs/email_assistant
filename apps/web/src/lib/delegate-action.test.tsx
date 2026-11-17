/// <reference types="bun" />
import { NEEDS_ACTION_CATEGORIES, categories, type ActivityItem, type Delegate, type Me } from "@ea/core/web";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DelegateAction } from "../components/activity/DelegateAction";
import { DelegateHintContext } from "../components/activity/DelegateHintProvider";
import { setLocaleForTest, t } from "../i18n";
import { ApiError } from "./api";
import {
  delegateErrorKey,
  delegateHintWanted,
  isExistsError,
  loadDelegateHint,
  showDelegateAction,
  type DelegateHint,
} from "./delegate-action";

afterEach(() => setLocaleForTest("en"));

const MAILBOX = "0190f5a0-0000-7000-8000-000000000003";
const OTHER_MAILBOX = "0190f5a0-0000-7000-8000-000000000004";
const anna: Delegate = {
  id: "0190f5a0-0000-7000-8000-0000000000a1",
  name: "Anna Nowak",
  email: "anna@example.com",
  tags: [],
  active: true,
  createdAt: "2026-11-01T10:00:00.000Z",
};
const hint = (over: Partial<DelegateHint> = {}): DelegateHint => ({
  delegates: [anna],
  draftMailboxIds: new Set([MAILBOX]),
  ...over,
});
const row = (over: Partial<Pick<ActivityItem, "category" | "mailboxId" | "suspicious" | "delegation">> = {}) => ({
  category: "needs_reply" as const,
  mailboxId: MAILBOX,
  suspicious: [] as ActivityItem["suspicious"],
  delegation: null,
  ...over,
});

describe("showDelegateAction (T1)", () => {
  test("it shows on the three categories of the Telegram rule and on no other category", () => {
    for (const category of categories) {
      const expected = (NEEDS_ACTION_CATEGORIES as readonly string[]).includes(category);
      expect({ category, shown: showDelegateAction(row({ category }), hint()) }).toEqual({ category, shown: expected });
    }
    expect([...NEEDS_ACTION_CATEGORIES]).toEqual(["urgent", "needs_reply", "unsure"]);
  });

  test("it needs the hint, an active delegate and a mailbox in assist mode with drafts on", () => {
    expect(showDelegateAction(row(), null)).toBe(false);
    expect(showDelegateAction(row(), hint({ delegates: [] }))).toBe(false);
    expect(showDelegateAction(row({ mailboxId: OTHER_MAILBOX }), hint())).toBe(false);
    expect(showDelegateAction(row(), hint({ draftMailboxIds: new Set() }))).toBe(false);
  });

  test("a suspicious mail and a mail with an open delegation show no action; a closed delegation does", () => {
    expect(showDelegateAction(row({ suspicious: ["lookalike_domain"] }), hint())).toBe(false);
    for (const status of ["drafted", "sent", "overdue"] as const) {
      expect(showDelegateAction(row({ delegation: { delegateName: "Ola", status, dueAt: null } }), hint())).toBe(false);
    }
    for (const status of ["answered", "done", "cancelled"] as const) {
      expect(showDelegateAction(row({ delegation: { delegateName: "Ola", status, dueAt: null } }), hint())).toBe(true);
    }
  });
});

const meOf = (over: Partial<Pick<Me, "role" | "features">> & { plan?: string } = {}): Me =>
  ({
    role: over.role ?? "owner",
    features: over.features ?? ["delegate_button", "delegation_pages"],
    organization: { plan: over.plan ?? "active" },
  }) as unknown as Me;

describe("delegateHintWanted (T1, roles)", () => {
  test("only an owner of an active organization with the flag on", () => {
    expect(delegateHintWanted(meOf())).toBe(true);
    expect(delegateHintWanted(meOf({ role: "assistant" }))).toBe(false);
    expect(delegateHintWanted(meOf({ features: ["open_loops"] }))).toBe(false);
    // `GET /delegates` needs the flag `delegation_pages`: without it the list is a 404.
    expect(delegateHintWanted(meOf({ features: ["delegate_button"] }))).toBe(false);
    expect(delegateHintWanted(meOf({ features: ["delegation_pages"] }))).toBe(false);
    expect(delegateHintWanted(meOf({ plan: "suspended" }))).toBe(false);
    expect(delegateHintWanted(null)).toBe(false);
  });
});

function render(item: ActivityItem, value: DelegateHint | null): string {
  return renderToStaticMarkup(
    <DelegateHintContext.Provider value={value}>
      <DelegateAction item={item} onGone={() => undefined} />
    </DelegateHintContext.Provider>
  );
}

describe("DelegateAction (T1, render)", () => {
  setLocaleForTest("en");
  const item = (category: ActivityItem["category"]) =>
    ({ ...row({ category }), emailId: "e1", subject: "S" }) as ActivityItem;

  test("the button shows for the three categories with a hint and nowhere else", () => {
    for (const category of categories) {
      const html = render(item(category), hint());
      expect({ category, button: html.includes(t("dla_button")) }).toEqual({
        category,
        button: (NEEDS_ACTION_CATEGORIES as readonly string[]).includes(category),
      });
    }
    expect(render(item("needs_reply"), null)).toBe("");
  });
});

describe("delegateErrorKey (T2 keys)", () => {
  test("each 409 code has its own text; other errors use the text of the code", () => {
    const refusal = (code: string) => new ApiError(409, code);
    expect(delegateErrorKey(refusal("exists"))).toBe("dla_exists");
    expect(delegateErrorKey(refusal("delegate_inactive"))).toBe("dla_inactive");
    expect(delegateErrorKey(refusal("drafts_off"))).toBe("dla_drafts_off");
    expect(delegateErrorKey(refusal("not_delegable"))).toBe("dla_not_delegable");
    expect(delegateErrorKey(new ApiError(404, "not_found"))).toBe("err_not_found");
    expect(delegateErrorKey(new ApiError(403, "owner_only"))).toBe("owner_only");
    expect(delegateErrorKey(new ApiError(409, "unknown_code"))).toBe("error_generic");
    expect(delegateErrorKey(new Error("x"))).toBe("error_generic");
    expect(isExistsError(refusal("exists"))).toBe(true);
    expect(isExistsError(refusal("drafts_off"))).toBe(false);
  });
});

describe("loadDelegateHint", () => {
  test("keeps active delegates, reads settings of assist mailboxes only and drops a mailbox without drafts or a failed read", async () => {
    const calls: string[] = [];
    const idle = { ...anna, id: "0190f5a0-0000-7000-8000-0000000000a2", active: false };
    const settings = (id: string, draft: boolean) => ({
      mailboxId: id,
      mode: "assist",
      toolSwitches: { move: true, flag: true, mark_read: true, create_draft: draft, move_unsure: false },
      movesSupported: true,
      categories: [],
      syncFolders: [],
      urgencyProfile: null,
      sentSync: null,
      sentTracking: "flag_off",
      loopWaitDays: 3,
      bar: 0.98,
      minKept: 30,
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/delegates") return Response.json({ items: [anna, idle] });
      if (url.endsWith(MAILBOX)) return Response.json(settings(MAILBOX, true));
      if (url.endsWith("0190f5a0-0000-7000-8000-000000000005")) return Response.json(settings(OTHER_MAILBOX, false));
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch);
    try {
      const result = await loadDelegateHint([
        { id: MAILBOX, mode: "assist" },
        { id: "0190f5a0-0000-7000-8000-000000000005", mode: "assist" },
        { id: "0190f5a0-0000-7000-8000-000000000006", mode: "assist" },
        { id: "0190f5a0-0000-7000-8000-000000000007", mode: "shadow" },
        { id: "0190f5a0-0000-7000-8000-000000000008", mode: null },
      ]);
      expect(result.delegates.map((delegate) => delegate.name)).toEqual(["Anna Nowak"]);
      expect([...result.draftMailboxIds]).toEqual([MAILBOX]);
      expect(calls.filter((url) => url.startsWith("/api/settings/"))).toHaveLength(3);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
