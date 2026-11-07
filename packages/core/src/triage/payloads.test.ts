import { describe, expect, test } from "bun:test";

import { draftPayloadSchema, sendPayloadFor, sendPayloadSchema, type DraftPayload } from "./payloads";

const ID = "5b1f3c2e-0a4d-4e8b-9c6f-1d2e3f4a5b6c";
const ID2 = "6c2a4d3f-1b5e-4f9c-8d7a-2e3f4a5b6c7d";

const delegation: Extract<DraftPayload, { kind: "delegation" }> = {
  kind: "delegation",
  delegate_id: ID,
  delegate_name: "Anna",
  to: ["anna@firma.test"],
  task: "Prepare the offer.",
  due_date: "2026-11-10",
  language: "en",
};
const clarification: Extract<DraftPayload, { kind: "clarification" }> = {
  kind: "clarification",
  to: ["jan@firma.test"],
  question: "Who should do this?",
  language: "pl",
};
const reminder: Extract<DraftPayload, { kind: "reminder" }> = {
  kind: "reminder",
  delegate_id: ID,
  delegate_name: "Anna",
  to: ["anna@firma.test"],
  task: "Prepare the offer.",
  due_date: "",
  language: "en",
  delegation_id: ID2,
  reminder: 1,
  thread: { in_reply_to: "<a@b.test>", references: ["<a@b.test>"] },
};

const badAddresses = ["x@y.test, evil@z.test", "<x@y.test>"];

describe("draftPayloadSchema", () => {
  test.each([delegation, clarification, reminder])("$kind parses", (payload) => {
    expect(draftPayloadSchema.safeParse(payload).success).toBe(true);
  });

  test("a `to` with two addresses is refused", () => {
    for (const payload of [delegation, clarification, reminder]) {
      expect(draftPayloadSchema.safeParse({ ...payload, to: ["a@b.test", "c@d.test"] }).success).toBe(false);
    }
  });

  test("due_date accepts a date and an empty string, refuses another shape", () => {
    expect(draftPayloadSchema.safeParse({ ...delegation, due_date: "2026-11-10" }).success).toBe(true);
    expect(draftPayloadSchema.safeParse({ ...delegation, due_date: "" }).success).toBe(true);
    expect(draftPayloadSchema.safeParse({ ...delegation, due_date: "10.11.2026" }).success).toBe(false);
    expect(draftPayloadSchema.safeParse({ ...delegation, due_date: "2026-13-01" }).success).toBe(true);
  });

  test("a bad address is refused in every draft kind", () => {
    for (const payload of [delegation, clarification, reminder]) {
      for (const bad of badAddresses) {
        expect(draftPayloadSchema.safeParse({ ...payload, to: [bad] }).success).toBe(false);
      }
    }
  });
});

describe("sendPayloadSchema", () => {
  test("parses and refuses a bad address", () => {
    expect(sendPayloadSchema.safeParse({ kind: "delegation", to: ["a@b.test"], delegate_id: ID }).success).toBe(true);
    for (const bad of badAddresses) {
      expect(sendPayloadSchema.safeParse({ kind: "delegation", to: [bad] }).success).toBe(false);
    }
    expect(sendPayloadSchema.safeParse({ kind: "delegation", to: ["a@b.test", "c@d.test"] }).success).toBe(false);
  });
});

describe("sendPayloadFor", () => {
  test("copies the fields of a delegation draft", () => {
    expect(sendPayloadFor(delegation)).toEqual({ kind: "delegation", to: ["anna@firma.test"], delegate_id: ID });
  });

  test("copies the fields of a clarification draft", () => {
    expect(sendPayloadFor(clarification)).toEqual({ kind: "clarification", to: ["jan@firma.test"] });
  });

  test("copies the fields of a reminder draft", () => {
    expect(sendPayloadFor(reminder)).toEqual({
      kind: "reminder",
      to: ["anna@firma.test"],
      delegate_id: ID,
      delegation_id: ID2,
      reminder: 1,
    });
  });
});
