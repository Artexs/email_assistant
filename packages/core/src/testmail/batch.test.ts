import { describe, expect, test } from "bun:test";

import { classifierCategories } from "../triage/categories";

import {
  personaFileSchema,
  batchCategories,
  batchSchema,
  testmailCategories,
  validateBatch,
  type Batch,
  type BatchCase,
  type BatchIssue,
  type PersonaFile,
} from "./batch";

const personas: PersonaFile = {
  inbox: { username: "ea-testmail", clientId: "ea-testmail-1", defaultDisplayName: "Test Inbox" },
  personas: [
    { key: "boss", displayName: "Anna Boss", group: "work", lang: "pl", voice: "boss" },
    { key: "peer", displayName: "Piotr Peer", group: "work", lang: "en", voice: "peer" },
    { key: "shop", displayName: "Shop News", group: "services", lang: "pl", voice: "shop" },
  ],
};

function makeCase(id: string, overrides: Partial<BatchCase> = {}): BatchCase {
  return {
    id,
    persona: "boss",
    lang: "pl",
    subject: `Temat ${id}`,
    body: `Tresc ${id}`,
    expected: { category: "info" },
    ...overrides,
  };
}

function makeBatch(cases: BatchCase[]): Batch {
  return { batch: "2026-11-08-a", writer: "claude-sonnet-5-5", delegatesActive: false, cases };
}

const opts = { fileBatchId: "2026-11-08-a", requireBlind: false };

function codes(issues: BatchIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function bodyIssues(body: string, extra: { testAddress?: string } = {}): BatchIssue[] {
  return validateBatch(makeBatch([makeCase("a", { body })]), personas, { ...opts, ...extra });
}

describe("validateBatch", () => {
  test("accepts a valid batch", () => {
    const batch = makeBatch([
      makeCase("a"),
      makeCase("b", { persona: "shop" }),
      makeCase("c", { persona: "peer", lang: "en", replyTo: "a" }),
    ]);
    expect(validateBatch(batch, personas, opts)).toEqual([]);
  });

  test("flags a duplicate id on the second case", () => {
    const issues = validateBatch(makeBatch([makeCase("a"), makeCase("a")]), personas, opts);
    expect(issues).toEqual([{ caseId: "a", code: "duplicate_id", detail: expect.any(String) }]);
  });

  test("flags an unknown persona and a language mismatch", () => {
    const issues = validateBatch(
      makeBatch([makeCase("a", { persona: "nobody" }), makeCase("b", { lang: "en" })]),
      personas,
      opts
    );
    expect(issues.map((issue) => [issue.caseId, issue.code])).toEqual([
      ["a", "unknown_persona"],
      ["b", "lang_mismatch"],
    ]);
  });

  test("checks replyTo", () => {
    expect(codes(validateBatch(makeBatch([makeCase("a", { replyTo: "zzz" })]), personas, opts))).toEqual([
      "reply_unknown",
    ]);
    const later = makeBatch([makeCase("a", { replyTo: "b" }), makeCase("b")]);
    expect(codes(validateBatch(later, personas, opts))).toEqual(["reply_not_earlier"]);
    const services = makeBatch([makeCase("a"), makeCase("b", { persona: "shop", replyTo: "a" })]);
    expect(codes(validateBatch(services, personas, opts))).toEqual(["reply_persona"]);
  });

  test("checks e-mail address hosts", () => {
    expect(codes(bodyIssues("write to jan@firma.pl"))).toEqual(["address_not_reserved"]);
    expect(bodyIssues("write to jan@firma.test and x@sub.example.com")).toEqual([]);
  });

  test("checks url hosts", () => {
    expect(codes(bodyIssues("https://bank-login.com/x"))).toEqual(["url_not_reserved"]);
    expect(bodyIssues("https://example.com/a http://portal.test/ www.example.org")).toEqual([]);
    expect(codes(bodyIssues("www.realshop.pl"))).toEqual(["url_not_reserved"]);
    expect(codes(bodyIssues("bank-login.com/verify"))).toEqual(["url_not_reserved"]);
    expect(bodyIssues("portal.example.com")).toEqual([]);
    expect(bodyIssues("raport.pdf")).toEqual([]);
    expect(bodyIssues("see https://portal.example.com.")).toEqual([]);
    expect(bodyIssues("(http://portal.test)")).toEqual([]);
  });

  test("checks phone numbers", () => {
    expect(codes(bodyIssues("call 600 123 456"))).toEqual(["phone_number"]);
    expect(bodyIssues("order 12345678")).toEqual([]);
  });

  test("flags the test mailbox address", () => {
    const issues = bodyIssues("mail BOSS@interia.test", { testAddress: "boss@interia.test" });
    expect(issues.map((issue) => issue.code)).toContain("test_address");
  });

  test("checks the blind label only when required", () => {
    const required = { ...opts, requireBlind: true };
    const missing = validateBatch(makeBatch([makeCase("a")]), personas, required);
    expect(codes(missing)).toEqual(["blind_missing"]);

    const disagree = makeCase("a", { expected: { category: "spam" }, blind: { category: "info" } });
    expect(codes(validateBatch(makeBatch([disagree]), personas, required))).toEqual(["blind_disagrees"]);

    const borderline = { ...disagree, note: "borderline: promo or info" };
    expect(validateBatch(makeBatch([borderline]), personas, required)).toEqual([]);

    expect(validateBatch(makeBatch([makeCase("a"), { ...disagree, id: "b" }]), personas, opts)).toEqual([]);
  });

  test("flags a line break in the subject", () => {
    const batch = makeBatch([makeCase("a", { subject: "one\ntwo" })]);
    expect(codes(validateBatch(batch, personas, opts))).toEqual(["subject_line_break"]);
  });

  test("flags a batch id that differs from the file name", () => {
    const issues = validateBatch(makeBatch([makeCase("a")]), personas, { ...opts, fileBatchId: "2026-11-08-b" });
    expect(issues).toEqual([{ caseId: null, code: "batch_id_mismatch", detail: expect.any(String) }]);
  });

  test("detail never holds the matched text", () => {
    const texts = ["jan@firma.pl", "bank-login.com", "600 123 456", "boss@interia.test"];
    const issues = bodyIssues(`${texts.join(" ")}`, { testAddress: "boss@interia.test" });
    expect(issues.length).toBeGreaterThan(3);
    for (const issue of issues) {
      for (const text of texts) expect(issue.detail.toLowerCase()).not.toContain(text);
    }
  });
});

describe("validateBatch rules", () => {
  const required = { ...opts, requireBlind: true };
  const reply = (id: string, persona: string, replyTo: string, lang: "pl" | "en" = "pl") =>
    makeCase(id, { persona, lang, replyTo });
  interface Row {
    name: string;
    cases: BatchCase[];
    options?: { fileBatchId: string; testAddress?: string; requireBlind: boolean };
    delegatesActive?: boolean;
    issues: BatchIssue[];
  }
  const issue = (caseId: string | null, code: BatchIssue["code"], detail: string): BatchIssue => ({
    caseId,
    code,
    detail,
  });

  const rows: Row[] = [
    {
      name: "a duplicate id is flagged on the second case only",
      cases: [makeCase("c1"), makeCase("c1")],
      issues: [issue("c1", "duplicate_id", "id: not unique in the batch")],
    },
    {
      name: "an unknown persona is flagged without a language issue",
      cases: [makeCase("a", { persona: "nobody", lang: "en" })],
      issues: [issue("a", "unknown_persona", "persona: key not in the persona file")],
    },
    {
      name: "a case language that differs from the persona language",
      cases: [makeCase("a", { persona: "boss", lang: "en" })],
      issues: [issue("a", "lang_mismatch", "lang: differs from the persona lang")],
    },
    {
      name: "replyTo with an id that is not in the batch",
      cases: [makeCase("a", { replyTo: "nope" })],
      issues: [issue("a", "reply_unknown", "replyTo: no case with this id")],
    },
    {
      name: "replyTo to the case itself",
      cases: [makeCase("a", { replyTo: "a" })],
      issues: [issue("a", "reply_not_earlier", "replyTo: parent is not an earlier case")],
    },
    {
      name: "replyTo to a later case",
      cases: [makeCase("a", { replyTo: "b" }), makeCase("b")],
      issues: [issue("a", "reply_not_earlier", "replyTo: parent is not an earlier case")],
    },
    {
      name: "replyTo an earlier case of another persona outside the work group",
      cases: [makeCase("a"), reply("b", "shop", "a")],
      issues: [issue("b", "reply_persona", "replyTo: persona differs from the parent and is not in group work")],
    },
    {
      name: "replyTo an earlier case of another persona in the work group",
      cases: [makeCase("a"), reply("b", "peer", "a", "en")],
      issues: [],
    },
    {
      name: "replyTo an earlier case of the same persona outside the work group",
      cases: [makeCase("a", { persona: "shop" }), reply("b", "shop", "a")],
      issues: [],
    },
    {
      name: "a line feed in the subject",
      cases: [makeCase("a", { subject: "a\nb" })],
      issues: [issue("a", "subject_line_break", "subject: contains a line break")],
    },
    {
      name: "a carriage return in the subject",
      cases: [makeCase("a", { subject: "a\rb" })],
      issues: [issue("a", "subject_line_break", "subject: contains a line break")],
    },
    {
      name: "an address on a real host in the body",
      cases: [makeCase("a", { body: "jan@gmail.com" })],
      issues: [issue("a", "address_not_reserved", "body: address host not reserved")],
    },
    {
      name: "an address on a real host in the subject",
      cases: [makeCase("a", { subject: "jan@gmail.com" })],
      issues: [issue("a", "address_not_reserved", "subject: address host not reserved")],
    },
    {
      name: "a link to a real host in the body",
      cases: [makeCase("a", { body: "https://gmail.com/x" })],
      issues: [issue("a", "url_not_reserved", "body: host not reserved")],
    },
    {
      name: "a link to a real host in the subject",
      cases: [makeCase("a", { subject: "https://gmail.com/x" })],
      issues: [issue("a", "url_not_reserved", "subject: host not reserved")],
    },
    {
      name: "a number with 9 digits in the body",
      cases: [makeCase("a", { body: "123456789" })],
      issues: [issue("a", "phone_number", "body: number with 9 or more digits")],
    },
    {
      name: "a number with 9 digits in the subject",
      cases: [makeCase("a", { subject: "600 123 456" })],
      issues: [issue("a", "phone_number", "subject: number with 9 or more digits")],
    },
    {
      name: "a link to a host with an unknown ending",
      cases: [makeCase("a", { body: "https://intranet.local/x" })],
      issues: [issue("a", "url_not_reserved", "body: host not reserved")],
    },
    {
      name: "a www host with an unknown ending",
      cases: [makeCase("a", { body: "www.firma.local" })],
      issues: [issue("a", "url_not_reserved", "body: host not reserved")],
    },
    { name: "the bare host test", cases: [makeCase("a", { body: "http://test/x" })], issues: [] },
    {
      name: "a reserved host followed by two closing marks",
      cases: [makeCase("a", { body: "(see http://portal.test)." })],
      issues: [],
    },
    { name: "a number with 8 digits", cases: [makeCase("a", { body: "12345678" })], issues: [] },
    { name: "a spaced number with 8 digits", cases: [makeCase("a", { body: "1234 5678" })], issues: [] },
    {
      name: "the test mailbox address in the body, whatever its case and padding",
      cases: [makeCase("a", { body: "write to test@example.com" })],
      options: { ...opts, testAddress: " Test@Example.COM " },
      issues: [issue("a", "test_address", "body: contains the test mailbox address")],
    },
    {
      name: "the test mailbox address in the subject",
      cases: [makeCase("a", { subject: "TEST@example.com" })],
      options: { ...opts, testAddress: " Test@Example.COM " },
      issues: [issue("a", "test_address", "subject: contains the test mailbox address")],
    },
    {
      name: "a blank test mailbox address flags nothing",
      cases: [makeCase("a")],
      options: { ...opts, testAddress: "   " },
      issues: [],
    },
    {
      name: "an expected delegation without active delegates",
      cases: [makeCase("a", { expected: { category: "delegation" } })],
      issues: [issue("a", "delegation_without_delegates", "expected: delegation needs delegatesActive")],
    },
    {
      name: "an expected and a blind delegation without active delegates when blind is required",
      cases: [makeCase("a", { expected: { category: "delegation" }, blind: { category: "delegation" } })],
      options: required,
      issues: [
        issue("a", "delegation_without_delegates", "expected: delegation needs delegatesActive"),
        issue("a", "delegation_without_delegates", "blind: delegation needs delegatesActive"),
      ],
    },
    {
      name: "an expected delegation with active delegates",
      cases: [makeCase("a", { expected: { category: "delegation" } })],
      delegatesActive: true,
      issues: [],
    },
    {
      name: "a blind delegation with active delegates when blind is required",
      cases: [makeCase("a", { blind: { category: "delegation" }, expected: { category: "delegation" } })],
      options: required,
      delegatesActive: true,
      issues: [],
    },
    {
      name: "a missing blind label when blind is required",
      cases: [makeCase("a")],
      options: required,
      issues: [issue("a", "blind_missing", "blind: category missing")],
    },
    {
      name: "a blind label that differs from the expected category",
      cases: [makeCase("a", { blind: { category: "spam" } })],
      options: required,
      issues: [issue("a", "blind_disagrees", "blind: category differs from expected and note is not borderline")],
    },
    {
      name: "a blind label that differs, with a borderline note",
      cases: [makeCase("a", { blind: { category: "spam" }, note: "borderline: x" })],
      options: required,
      issues: [],
    },
    {
      name: "a blind label that differs, with a note that is not borderline",
      cases: [makeCase("a", { blind: { category: "spam" }, note: "attack: x" })],
      options: required,
      issues: [issue("a", "blind_disagrees", "blind: category differs from expected and note is not borderline")],
    },
    {
      name: "a blind label equal to the expected category",
      cases: [makeCase("a", { blind: { category: "info" } })],
      options: required,
      issues: [],
    },
    {
      name: "a batch id that differs from the file name comes last",
      cases: [makeCase("a", { persona: "nobody" })],
      options: { ...opts, fileBatchId: "2026-11-09-b" },
      issues: [
        issue("a", "unknown_persona", "persona: key not in the persona file"),
        issue(null, "batch_id_mismatch", "batch: differs from the file name"),
      ],
    },
    {
      name: "one case that breaks several rules lists them in rule order",
      cases: [
        makeCase("a"),
        makeCase("a", {
          persona: "nobody",
          replyTo: "zzz",
          subject: "x\ny jan@gmail.com",
          body: "https://gmail.com 600 123 456 jan@gmail.com",
        }),
      ],
      issues: [
        issue("a", "duplicate_id", "id: not unique in the batch"),
        issue("a", "unknown_persona", "persona: key not in the persona file"),
        issue("a", "reply_unknown", "replyTo: no case with this id"),
        issue("a", "subject_line_break", "subject: contains a line break"),
        issue("a", "address_not_reserved", "subject: address host not reserved"),
        issue("a", "address_not_reserved", "body: address host not reserved"),
        issue("a", "url_not_reserved", "body: host not reserved"),
        issue("a", "phone_number", "body: number with 9 or more digits"),
      ],
    },
  ];

  test.each(rows)("$name", ({ cases, options, delegatesActive, issues }) => {
    const batch = { ...makeBatch(cases), delegatesActive: delegatesActive ?? false };
    expect(validateBatch(batch, personas, options ?? opts)).toEqual(issues);
  });
});

describe("delegation category", () => {
  const delegationCase = makeCase("a", { expected: { category: "delegation" } });
  const delegationCodes = (batch: Batch, extra: { requireBlind: boolean }) =>
    codes(validateBatch(batch, personas, { ...opts, ...extra })).filter(
      (code) => code === "delegation_without_delegates"
    );

  test("a batch without delegatesActive defaults to false", () => {
    const parsed = batchSchema.parse({ batch: "2026-11-08-a", writer: "w", cases: [makeCase("a")] });
    expect(parsed.delegatesActive).toBe(false);
  });

  test("an expected delegation without delegatesActive is one issue", () => {
    expect(delegationCodes(makeBatch([delegationCase]), { requireBlind: false })).toEqual([
      "delegation_without_delegates",
    ]);
  });

  test("an expected delegation with delegatesActive is valid", () => {
    const batch = { ...makeBatch([delegationCase]), delegatesActive: true };
    expect(delegationCodes(batch, { requireBlind: false })).toEqual([]);
  });

  test("a blind delegation without delegatesActive is an issue when blind is required", () => {
    const batch = makeBatch([
      makeCase("a", { expected: { category: "needs_reply" }, blind: { category: "delegation" } }),
    ]);
    expect(delegationCodes(batch, { requireBlind: true })).toEqual(["delegation_without_delegates"]);
    expect(delegationCodes(batch, { requireBlind: false })).toEqual([]);
  });

  test("batchCategories is the test categories plus delegation", () => {
    expect([...batchCategories]).toEqual([...testmailCategories, "delegation"]);
  });
});

describe("personaFileSchema keys", () => {
  const issuesOf = (keys: string[]) => {
    const file = { ...personas, personas: keys.map((key) => ({ ...personas.personas[0], key })) };
    const result = personaFileSchema.safeParse(file);
    return result.success ? [] : result.error.issues.map(({ path, message }) => ({ path, message }));
  };

  test("a repeated key is an issue on each later persona, at its own index", () => {
    expect(issuesOf(["p1", "p2", "p1", "p1"])).toEqual([
      { path: ["personas", 2, "key"], message: "persona key not unique" },
      { path: ["personas", 3, "key"], message: "persona key not unique" },
    ]);
    expect(issuesOf(["p1", "p1"])).toEqual([{ path: ["personas", 1, "key"], message: "persona key not unique" }]);
  });

  test("distinct keys give no issue", () => {
    expect(issuesOf(["p1", "p2"])).toEqual([]);
  });
});

describe("personaFileSchema", () => {
  test("refuses duplicate keys and a display name with <", () => {
    const dup = { ...personas, personas: [personas.personas[0], personas.personas[0]] };
    expect(personaFileSchema.safeParse(dup).success).toBe(false);
    const bad = { ...personas, personas: [{ ...personas.personas[0], displayName: "Anna <x>" }] };
    expect(personaFileSchema.safeParse(bad).success).toBe(false);
    expect(personaFileSchema.safeParse(personas).success).toBe(true);
  });
});

test("testmailCategories equals classifierCategories", () => {
  expect<string[]>([...testmailCategories]).toEqual([...classifierCategories]);
});
