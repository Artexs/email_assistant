import { z } from "zod";

export const testmailCategories = ["urgent", "needs_reply", "info", "notification", "spam"] as const;
export type TestmailCategory = (typeof testmailCategories)[number];
// `delegation` is legal only in a batch with delegatesActive: true (the VPS has active delegates).
export const batchCategories = [...testmailCategories, "delegation"] as const;
export type BatchCategory = (typeof batchCategories)[number];
export const personaGroups = ["work", "services", "outside"] as const;

const displayNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[^<>"\r\n@]+$/);

export const personaSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,40}$/),
  displayName: displayNameSchema,
  group: z.enum(personaGroups),
  lang: z.enum(["pl", "en"]),
  voice: z.string().min(1).max(500),
});

export const personaFileSchema = z
  .object({
    inbox: z.object({
      username: z.string().regex(/^[a-z0-9-]{1,64}$/),
      clientId: z.string().regex(/^[A-Za-z0-9._~-]{1,64}$/),
      defaultDisplayName: displayNameSchema,
    }),
    personas: z.array(personaSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.personas.forEach((persona, index) => {
      if (seen.has(persona.key)) {
        ctx.addIssue({ code: "custom", path: ["personas", index, "key"], message: "persona key not unique" });
      }
      seen.add(persona.key);
    });
  });
export type PersonaFile = z.infer<typeof personaFileSchema>;

export const BATCH_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,40}$/;

export const batchCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    persona: z.string(),
    lang: z.enum(["pl", "en"]),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(6000),
    expected: z.object({ category: z.enum(batchCategories) }),
    blind: z.object({ category: z.enum(batchCategories) }).optional(),
    replyTo: z.string().optional(),
    note: z.string().max(300).optional(),
  })
  .strict();

export const batchSchema = z
  .object({
    batch: z.string().regex(BATCH_ID_PATTERN),
    writer: z.string().min(1).max(80),
    checker: z.string().min(1).max(80).optional(),
    delegatesActive: z.boolean().default(false),
    cases: z.array(batchCaseSchema).min(1).max(200),
  })
  .strict();
export type Batch = z.infer<typeof batchSchema>;
export type BatchCase = z.infer<typeof batchCaseSchema>;

export type BatchIssueCode =
  | "duplicate_id"
  | "unknown_persona"
  | "lang_mismatch"
  | "reply_unknown"
  | "reply_not_earlier"
  | "reply_persona"
  | "subject_line_break"
  | "address_not_reserved"
  | "url_not_reserved"
  | "phone_number"
  | "test_address"
  | "blind_missing"
  | "blind_disagrees"
  | "batch_id_mismatch"
  | "delegation_without_delegates";

// detail holds ids, field names and counts only, never mail text.
export interface BatchIssue {
  caseId: string | null;
  code: BatchIssueCode;
  detail: string;
}

const ADDRESS_PATTERN = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const HTTP_HOST_PATTERN = /\bhttps?:\/\/([^\s/:?#]+)/gi;
const WWW_HOST_PATTERN = /\bwww\.([^\s/:?#]+)/gi;
const BARE_DOMAIN_PATTERN =
  /\b((?:[a-z0-9-]+\.)+(?:com|pl|net|org|eu|io|info|biz|co|uk|de|app|online|shop|xyz|me|site))\b/gi;
const PHONE_PATTERN = /\d[\d\s-]{7,}\d/g;
const RESERVED_HOSTS = ["example.com", "example.org", "example.net"];

export function isReservedHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/[.,;:!?)\]]+$/, "");
  return (
    host === "test" ||
    host.endsWith(".test") ||
    RESERVED_HOSTS.some((reserved) => host === reserved || host.endsWith(`.${reserved}`))
  );
}

export function hasUnreservedAddress(text: string): boolean {
  return [...text.matchAll(ADDRESS_PATTERN)].some((match) => !isReservedHost(match[1] ?? ""));
}

export function hasUnreservedUrl(text: string): boolean {
  const hosts: string[] = [];
  for (const pattern of [HTTP_HOST_PATTERN, WWW_HOST_PATTERN]) {
    for (const match of text.matchAll(pattern)) hosts.push(match[1] ?? "");
  }
  for (const match of text.matchAll(BARE_DOMAIN_PATTERN)) {
    if (text[(match.index ?? 0) - 1] === "@") continue;
    hosts.push(match[1] ?? "");
  }
  return hosts.some((host) => !isReservedHost(host));
}

export function hasPhoneNumber(text: string): boolean {
  return [...text.matchAll(PHONE_PATTERN)].some((match) => match[0].replace(/\D/g, "").length >= 9);
}

// Lists every rule violation of a batch (D7). Never throws; an empty list means valid.
export function validateBatch(
  batch: Batch,
  personas: PersonaFile,
  opts: { fileBatchId: string; testAddress?: string; requireBlind: boolean }
): BatchIssue[] {
  const issues: BatchIssue[] = [];
  const personaByKey = new Map(personas.personas.map((persona) => [persona.key, persona]));
  const indexById = new Map<string, number>();
  batch.cases.forEach((batchCase, index) => {
    if (!indexById.has(batchCase.id)) indexById.set(batchCase.id, index);
  });
  const testAddress = opts.testAddress?.trim().toLowerCase();

  batch.cases.forEach((batchCase, index) => {
    const add = (code: BatchIssueCode, detail: string) => issues.push({ caseId: batchCase.id, code, detail });
    const persona = personaByKey.get(batchCase.persona);

    if (indexById.get(batchCase.id) !== index) add("duplicate_id", "id: not unique in the batch");
    if (!persona) add("unknown_persona", "persona: key not in the persona file");
    else if (persona.lang !== batchCase.lang) add("lang_mismatch", "lang: differs from the persona lang");

    if (batchCase.replyTo !== undefined) {
      const parentIndex = indexById.get(batchCase.replyTo);
      if (parentIndex === undefined) add("reply_unknown", "replyTo: no case with this id");
      else if (parentIndex >= index) add("reply_not_earlier", "replyTo: parent is not an earlier case");
      else {
        const parent = batch.cases[parentIndex];
        if (parent && parent.persona !== batchCase.persona && persona && persona.group !== "work") {
          add("reply_persona", "replyTo: persona differs from the parent and is not in group work");
        }
      }
    }

    if (/[\r\n]/.test(batchCase.subject)) add("subject_line_break", "subject: contains a line break");

    for (const [field, text] of [
      ["subject", batchCase.subject],
      ["body", batchCase.body],
    ] as const) {
      if (hasUnreservedAddress(text)) add("address_not_reserved", `${field}: address host not reserved`);
      if (hasUnreservedUrl(text)) add("url_not_reserved", `${field}: host not reserved`);
      if (hasPhoneNumber(text)) add("phone_number", `${field}: number with 9 or more digits`);
      if (testAddress && text.toLowerCase().includes(testAddress)) {
        add("test_address", `${field}: contains the test mailbox address`);
      }
    }

    if (!batch.delegatesActive) {
      if (batchCase.expected.category === "delegation") {
        add("delegation_without_delegates", "expected: delegation needs delegatesActive");
      }
      if (opts.requireBlind && batchCase.blind?.category === "delegation") {
        add("delegation_without_delegates", "blind: delegation needs delegatesActive");
      }
    }

    if (opts.requireBlind) {
      if (!batchCase.blind) add("blind_missing", "blind: category missing");
      else if (batchCase.blind.category !== batchCase.expected.category && !batchCase.note?.startsWith("borderline:")) {
        add("blind_disagrees", "blind: category differs from expected and note is not borderline");
      }
    }
  });

  if (batch.batch !== opts.fileBatchId)
    issues.push({ caseId: null, code: "batch_id_mismatch", detail: "batch: differs from the file name" });
  return issues;
}
