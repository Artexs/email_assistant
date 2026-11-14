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
