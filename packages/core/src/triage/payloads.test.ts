import { describe, expect, test } from "bun:test";

import {
  draftPayloadSchema,
  draftVersion,
  dueDateOrNone,
  sendPayloadFor,
  sendPayloadSchema,
  type DraftPayload,
} from "./payloads";

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

  test("a due date that is not a real calendar date is refused with an invalid_format issue", () => {
    const result = draftPayloadSchema.safeParse({ ...delegation, due_date: "2026-13-01" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "invalid_format", path: ["due_date"] },
    ]);
  });

  describe.each([
    ["delegation", delegation],
    ["reminder", reminder],
  ])("due_date of a %s draft", (_kind, fixture) => {
    test.each([
      ["2026-11-10", true],
      ["", true],
      ["2028-02-29", true],
      ["2000-02-29", true],
      ["0001-01-01", true],
      ["9999-12-31", true],
      ["2026-13-01", false],
      ["2026-02-30", false],
      ["2026-02-29", false],
      ["1900-02-29", false],
      ["2026-04-31", false],
      ["2026-00-10", false],
      ["10.11.2026", false],
    ])("%p gives success %p", (due_date, success) => {
      expect(draftPayloadSchema.safeParse({ ...fixture, due_date }).success).toBe(success);
    });
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

describe("sendPayloadFor by draft kind", () => {
  const followUp: Extract<DraftPayload, { kind: "follow_up" }> = {
    kind: "follow_up",
    loop_id: ID,
    to: ["anna@firma.test", "jan@firma.test"],
    cc: ["boss@firma.test"],
    language: "en",
    sent_at: "2026-11-10T09:00:00.000Z",
    subject: "Offer",
    quote: null,
    n: 1,
    version: 2,
    subject_text: "Edited subject",
    body_text: "Edited body",
  };
  const reply: Extract<DraftPayload, { kind: "reply" }> = {
    kind: "reply",
    to: ["anna@firma.test"],
    cc: ["boss@firma.test"],
    language: "pl",
    body: "Thanks.",
    request_id: ID2,
    folder: "INBOX",
    recipients: "all",
  };

  test("a follow-up keeps its recipients, its Cc and its loop, and drops the text fields", () => {
    expect(sendPayloadFor(followUp)).toEqual({
      kind: "follow_up",
      to: ["anna@firma.test", "jan@firma.test"],
      cc: ["boss@firma.test"],
      loop_id: ID,
    });
  });

  test("a reply keeps its recipient and its Cc, and has no delegation keys", () => {
    expect(sendPayloadFor(reply)).toEqual({ kind: "reply", to: ["anna@firma.test"], cc: ["boss@firma.test"] });
  });

  test("a reply with an empty Cc keeps the empty list", () => {
    expect(sendPayloadFor({ ...reply, cc: [] })).toEqual({ kind: "reply", to: ["anna@firma.test"], cc: [] });
  });

  test.each([
    ["delegation", delegation, ["kind", "to", "delegate_id"]],
    ["clarification", clarification, ["kind", "to"]],
    ["reminder", reminder, ["kind", "to", "delegate_id", "delegation_id", "reminder"]],
    ["follow_up", followUp, ["kind", "to", "cc", "loop_id"]],
    ["reply", reply, ["kind", "to", "cc"]],
  ] as const)("a %s send has exactly its own keys", (_kind, draft, keys) => {
    expect(Object.keys(sendPayloadFor(draft)).sort()).toEqual([...keys].sort());
  });

  test("a reminder with the second reminder number keeps it", () => {
    expect(sendPayloadFor({ ...reminder, reminder: 2 }).reminder).toBe(2);
  });
});

describe("edit fields of a draft payload", () => {
  const body = "Hello Anna,\nplease send the report.\n\nAdam";

  test("an old payload parses and gets no new key", () => {
    for (const draft of [delegation, clarification]) {
      expect(draftPayloadSchema.parse(draft)).toEqual(draft);
    }
  });

  test("T8 the schema checks the length of the stored text", () => {
    const parse = (patch: object) => draftPayloadSchema.safeParse({ ...delegation, ...patch }).success;
    expect(parse({ body_text: "x".repeat(3000), subject_text: "y".repeat(200), version: 2 })).toBe(true);
    expect(parse({ body_text: "x".repeat(3001) })).toBe(false);
    expect(parse({ body_text: "" })).toBe(false);
    expect(parse({ subject_text: "y".repeat(201) })).toBe(false);
    expect(parse({ subject_text: "" })).toBe(false);
    expect(parse({ version: 0 })).toBe(false);
    expect(parse({ version: 1.5 })).toBe(false);
    expect(draftPayloadSchema.safeParse({ ...clarification, body_text: "x".repeat(3001) }).success).toBe(false);
    expect(draftPayloadSchema.safeParse({ ...clarification, body_text: body, version: 2 }).success).toBe(true);
  });

  test("T9 draftVersion, and a reminder drops the edit fields", () => {
    expect(draftVersion(delegation)).toBe(1);
    expect(draftVersion(draftPayloadSchema.parse({ ...delegation, version: 3 }))).toBe(3);
    expect(draftVersion(draftPayloadSchema.parse({ ...clarification, version: 2 }))).toBe(2);
    expect(draftVersion(reminder)).toBe(1);
    const parsed = draftPayloadSchema.parse({ ...reminder, body_text: body, subject_text: "S", version: 4 });
    expect("body_text" in parsed).toBe(false);
    expect("subject_text" in parsed).toBe(false);
    expect("version" in parsed).toBe(false);
  });
});

describe("dueDateOrNone", () => {
  test.each([
    ["2026-11-10", "2026-11-10"],
    ["", ""],
    ["2026-13-01", ""],
    [null, ""],
    [undefined, ""],
    [42, ""],
  ])("%p gives %p", (value, expected) => {
    expect(dueDateOrNone(value)).toBe(expected);
  });
});
