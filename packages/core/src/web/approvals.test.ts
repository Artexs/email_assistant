import { describe, expect, test } from "bun:test";

import { APPROVAL_LIST_MAX, approvalDetailSchema, approvalItemSchema, approvalListSchema } from "./approvals";

const id = "6f8f2f0e-7a8f-4c36-8f4c-0f3f7a1d9b11";
const view = {
  kind: "delegation",
  recipient: { name: "Anna", address: "anna@example.com" },
  sender: { label: "Boss", external: false },
  recipientInactive: false,
  subject: "Fwd: Offer",
  dueDate: null,
  body: "Hello",
  quote: { text: "> text", cut: false },
  synthetic: false,
};
const item = {
  id,
  version: 1,
  state: "waiting",
  draftReady: true,
  kind: "delegation",
  mailboxAddress: "box@x.test",
  createdAt: "2026-11-20T10:00:00.000Z",
  expiresAt: "2026-11-22T10:00:00.000Z",
  heldBy: null,
  delegationId: null,
  setId: null,
  view,
};
const detail = {
  ...item,
  state: "superseded",
  expiresAt: null,
  draftRemovable: true,
  currentId: id,
  quote: "> text",
  delegates: [{ id, name: "Anna", email: "anna@example.com" }],
};

describe("approval read schemas", () => {
  test("an item, a list and a detail parse", () => {
    expect(approvalItemSchema.parse(item) as unknown).toEqual(item);
    expect(approvalListSchema.parse({ items: [item] }).items).toHaveLength(1);
    expect(approvalDetailSchema.parse(detail).state).toBe("superseded");
  });

  test("every object is closed: an unknown key fails, also inside the view and the delegates", () => {
    expect(approvalItemSchema.safeParse({ ...item, payload: {} }).success).toBe(false);
    expect(approvalItemSchema.safeParse({ ...item, view: { ...view, bodyText: "x" } }).success).toBe(false);
    expect(approvalListSchema.safeParse({ items: [], next: null }).success).toBe(false);
    expect(approvalDetailSchema.safeParse({ ...detail, emailId: id }).success).toBe(false);
    expect(
      approvalDetailSchema.safeParse({ ...detail, delegates: [{ id, name: "A", email: "a@b.c", tags: [] }] }).success
    ).toBe(false);
  });

  test("the list holds at most 100 items; a list item has only the states waiting and held", () => {
    expect(approvalListSchema.safeParse({ items: Array(APPROVAL_LIST_MAX).fill(item) }).success).toBe(true);
    expect(approvalListSchema.safeParse({ items: Array(APPROVAL_LIST_MAX + 1).fill(item) }).success).toBe(false);
    expect(approvalItemSchema.safeParse({ ...item, state: "sent" }).success).toBe(false);
  });

  test("the detail allows a null view for a payload that retention cleared; the item does not", () => {
    const cleared = { ...detail, state: "expired", view: null, kind: null, version: null };
    expect(approvalDetailSchema.safeParse(cleared).success).toBe(true);
    expect(approvalItemSchema.safeParse({ ...item, view: null }).success).toBe(false);
  });

  test("heldBy takes the four reasons only", () => {
    for (const heldBy of ["scope", "paused", "auth_error", "host_blocked"]) {
      expect(approvalItemSchema.safeParse({ ...item, state: "held", heldBy }).success).toBe(true);
    }
    expect(approvalItemSchema.safeParse({ ...item, heldBy: "other" }).success).toBe(false);
  });
});
