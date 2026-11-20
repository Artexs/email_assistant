import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { readSeedFile, writeNewSeedFile } from "./files";
import { checkDemoSeed, parseDemoSeed, serializeDemoSeed } from "./format";
import { findNonTestAddress, findRealHost, hasNonTestAddress } from "./scan";
import { DEMO_TABLES, demoColumns, type DemoRow, type DemoTable } from "./tables";
import { buildImportRows, mapIdsInJson, mapIdsInText, PLACEHOLDER_SECRET } from "./transform";
import { DEMO_SEED_FORMAT, DemoSeedError, IMPORT_ORG_NAME, type DemoSeed } from "./types";

// The pure parts of the demo seed (scan, shape, id map, import rules). The database tests are in
// `test/integration/lab-demo-seed-export.test.ts`, `lab-demo-seed-import.test.ts` and `lab-demo-seed-refusals.test.ts`.

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(1);

// A row with every exported column of the table (null), then the given values.
function row(table: DemoTable, values: DemoRow): DemoRow {
  return { ...Object.fromEntries(demoColumns(table).map((column) => [column, null])), ...values };
}

function blankSeed(): DemoSeed {
  const tables = Object.fromEntries(DEMO_TABLES.map((table) => [table, []])) as unknown as DemoSeed["tables"];
  tables.organizations = [row("organizations", { id: ORG, name: "Kordelan demo", plan: "trial" })];
  return { format: DEMO_SEED_FORMAT, scenario: "lab-01", runId: "week-20261123-aaaa", day: 4, exportedAt: "x", tables };
}

const MAILBOX = uuid(10);
const EMAIL_OPEN = uuid(20);
const EMAIL_DONE = uuid(21);
const DRAFT = uuid(30);
const SEND = uuid(31);
const DELEGATE = uuid(40);
const DELEGATION = uuid(41);
const OUT_PENDING = uuid(50);
const OUT_SENT = uuid(51);
const OUT_EDIT = uuid(52);
const USER = uuid(90);

// A small demo: one mailbox, two mails, a draft and a send (the send listed FIRST), a delegation, three outbox rows.
function demoSeed(): DemoSeed {
  const seed = blankSeed();
  const org = { org_id: ORG };
  seed.tables.mailboxes = [
    row("mailboxes", {
      id: MAILBOX,
      ...org,
      address: "box@kordelan.test",
      imap_host: "127.0.0.1",
      smtp_host: "127.0.0.1",
      status: "active",
    }),
  ];
  seed.tables.mailbox_settings = [
    row("mailbox_settings", { mailbox_id: MAILBOX, ...org, mode: "assist", tool_switches: {} }),
  ];
  seed.tables.delegates = [row("delegates", { id: DELEGATE, ...org, name: "D", email: "d@kordelan.test" })];
  seed.tables.emails = [
    row("emails", {
      id: EMAIL_OPEN,
      ...org,
      mailbox_id: MAILBOX,
      status: "pending",
      locked_at: "2026-11-23T10:00:00.000Z",
    }),
    row("emails", { id: EMAIL_DONE, ...org, mailbox_id: MAILBOX, status: "triaged" }),
  ];
  seed.tables.email_headers = [row("email_headers", { email_id: EMAIL_DONE, ...org, attachments: [], links: [] })];
  seed.tables.triage_feedback = [row("triage_feedback", { id: uuid(60), ...org, email_id: EMAIL_DONE, user_id: USER })];
  seed.tables.actions = [
    row("actions", {
      id: SEND,
      ...org,
      email_id: EMAIL_DONE,
      type: "send",
      status: "awaiting_approval",
      depends_on_action_id: DRAFT,
      approved_by: USER,
      payload: { delegation_id: DELEGATION, to: ["d@kordelan.test"], nested: [{ id: DRAFT }] },
      idempotency_key: `${EMAIL_DONE}:send`,
      locked_at: "2026-11-23T10:00:00.000Z",
    }),
    row("actions", { id: DRAFT, ...org, email_id: EMAIL_DONE, type: "create_draft", status: "applied", payload: {} }),
  ];
  seed.tables.delegations = [
    row("delegations", {
      id: DELEGATION,
      ...org,
      mailbox_id: MAILBOX,
      email_id: EMAIL_DONE,
      delegate_id: DELEGATE,
      draft_action_id: DRAFT,
      send_action_id: SEND,
      answered_email_id: EMAIL_OPEN,
    }),
  ];
  seed.tables.outbox = [
    row("outbox", {
      id: OUT_PENDING,
      ...org,
      user_id: USER,
      kind: "urgent",
      status: "pending",
      email_id: EMAIL_DONE,
      buttons: [],
      view: {},
    }),
    row("outbox", {
      id: OUT_SENT,
      ...org,
      user_id: USER,
      kind: "approval",
      status: "sent",
      email_id: EMAIL_DONE,
      dedup_key: `approval:${SEND}`,
      buttons: [[{ text: "OK", data: `ap:${SEND}` }]],
      view: { action_id: SEND },
    }),
    row("outbox", {
      id: OUT_EDIT,
      ...org,
      user_id: USER,
      kind: "approval_edit",
      status: "sent",
      email_id: EMAIL_DONE,
      edit_of_outbox_id: OUT_PENDING,
      buttons: [],
      view: {},
    }),
  ];
  seed.tables.audit_log = [
    row("audit_log", {
      id: "7",
      ...org,
      actor: `user:${USER}`,
      event: "llm.call",
      data: { mailbox_id: MAILBOX, tokens: 3 },
    }),
    row("audit_log", { id: "8", ...org, actor: "system", event: "x", email_id: EMAIL_DONE, action_id: SEND, data: {} }),
  ];
  return seed;
}

describe("the address and host scan", () => {
  test("only .test addresses pass; a candidate that is not a valid address is refused too", () => {
    for (const ok of [
      "a@x.test",
      "Write to a@x.test, b@kordelan.test.",
      "<a@demo.kordelan.test>",
      "no address here",
      "evil.com.test is a reserved host",
      "john(at)gmail.com",
      "a@X.TEST",
      "mailto:a@x.test?subject=hi",
    ]) {
      expect(hasNonTestAddress(ok)).toBe(false);
    }
    for (const bad of [
      "a@gmail.com",
      "<a@x.test.com>",
      "a@x.test.pl",
      "a@testx.com",
      "user@localhost",
      "a@test",
      '"a@x.org"',
      // A bare `@` and a handle are refused too (lab text has none).
      "@handle",
      "5 @ 3",
      "@gmail.com",
      "a@x.test.evil.com",
      "mailto:john@gmail.com",
      "john@bücher.de",
      "john@gmаil.com",
    ]) {
      expect(hasNonTestAddress(bad), bad).toBe(true);
    }
  });

  // The old scan needed a plain word before the `@`.
  test("B1: a quoted local part and an address literal are refused (the scan keys on the @, not on the word before it)", () => {
    for (const bad of [
      'write to "john"@gmail.com today',
      '"john doe"@gmail.com',
      "john@[10.0.0.1]",
      "john@[IPv6:::1]",
      'a@x.test, "b"@gmail.com',
    ]) {
      expect(hasNonTestAddress(bad), bad).toBe(true);
    }
    expect(findNonTestAddress([{ id: "1", body_text: 'write to "john"@gmail.com today' }])).toBe("body_text");
    expect(hasNonTestAddress('"john"@x.test')).toBe(false);
  });

  test("B1: a full-width at sign, a zero-width space and the NFKC forms are refused", () => {
    for (const bad of [
      "john＠gmail.com",
      "john@gmail.com\u200b",
      "john@x.test\u200b.evil.com",
      "john@ｇmail.com",
      "john＠［10.0.0.1］",
    ]) {
      expect(hasNonTestAddress(bad), bad).toBe(true);
    }
    expect(hasNonTestAddress("john＠x.test")).toBe(false);
  });

  test("B1: the encoded forms of the at sign are decoded before the scan: %40, &#64;, &#x40;, &commat; (also encoded twice)", () => {
    for (const bad of [
      "john%40gmail.com",
      "john%40GMAIL.com",
      "john&#64;gmail.com",
      "john&#064;gmail.com",
      "john&#x40;gmail.com",
      "john&#X40;gmail.com",
      "john&commat;gmail.com",
      "john%2540gmail.com",
      "john&amp;#64;gmail.com",
    ]) {
      expect(hasNonTestAddress(bad), bad).toBe(true);
    }
    for (const ok of ["john%40x.test", "john&#64;x.test", "john&commat;x.test", "100%25 sure"]) {
      expect(hasNonTestAddress(ok), ok).toBe(false);
    }
  });

  test("an address is found in a string, an array, a nested JSON value and a JSON key; the finding names the column", () => {
    const row: DemoRow = { id: "1", subject: "hello", to_addresses: ["a@x.test", "b@gmail.com"], data: {} };
    expect(findNonTestAddress([row])).toBe("to_addresses");
    expect(findNonTestAddress([{ data: { deep: [{ note: "see c@x.org" }] } }])).toBe("data");
    expect(findNonTestAddress([{ data: { "c@x.org": 1 } }])).toBe("data");
    expect(findNonTestAddress([{ subject: "a@x.test", data: { n: 1 } }])).toBeUndefined();
  });

  test("a mailbox host is a loopback name or a .test name", () => {
    const host = (imap: string, smtp = "127.0.0.1"): DemoRow[] => [{ imap_host: imap, smtp_host: smtp }];
    expect(findRealHost(host("127.0.0.1"))).toBeUndefined();
    expect(findRealHost(host("LOCALHOST", "imap.x.test"))).toBeUndefined();
    expect(findRealHost(host("imap.gmail.com"))).toBe("imap_host");
    expect(findRealHost(host("127.0.0.1", "smtp.gmail.com"))).toBe("smtp_host");
    expect(findRealHost(host("127.0.0.1.evil.com"))).toBe("imap_host");
    expect(findRealHost(host("evil-test"))).toBe("imap_host");
  });
});

describe("the shape of a seed file", () => {
  test("serialize and parse give the same seed; one row per line", () => {
    const seed = demoSeed();
    const text = serializeDemoSeed(seed);
    expect(parseDemoSeed(text)).toEqual(seed);
    expect(serializeDemoSeed(parseDemoSeed(text))).toBe(text);
    expect(text.split("\n").filter((line) => line.includes(`"id":"${MAILBOX}"`))).toHaveLength(1);
  });

  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (error) {
      return error instanceof DemoSeedError ? error.detail : `other: ${String(error)}`;
    }
    return undefined;
  };

  test("a wrong format, a table of users, a secret column, a missing column and a foreign org row are refused", () => {
    expect(codeOf(() => parseDemoSeed("not json"))).toBe("bad_format");
    expect(codeOf(() => checkDemoSeed({ ...demoSeed(), format: "ea-org-export" }))).toBe("bad_format");

    const users = demoSeed();
    (users.tables as Record<string, DemoRow[]>).users = [];
    expect(codeOf(() => checkDemoSeed(users))).toBe("bad_seed (users)");
    const credentials = demoSeed();
    (credentials.tables as Record<string, DemoRow[]>).mailbox_credentials = [];
    expect(codeOf(() => checkDemoSeed(credentials))).toBe("bad_seed (mailbox_credentials)");

    const secret = demoSeed();
    secret.tables.mailboxes = [{ ...(secret.tables.mailboxes[0] as DemoRow), encrypted_secret: "x" }];
    expect(codeOf(() => checkDemoSeed(secret))).toBe("bad_seed (mailboxes.encrypted_secret)");
    const derived = demoSeed();
    derived.tables.emails = [{ ...(derived.tables.emails[0] as DemoRow), from_address_lower: "a@x.test" }];
    expect(codeOf(() => checkDemoSeed(derived))).toBe("bad_seed (emails.from_address_lower)");

    const missing = demoSeed();
    const rest = Object.fromEntries(
      Object.entries(missing.tables.emails[0] as DemoRow).filter(([column]) => column !== "subject")
    );
    missing.tables.emails = [rest];
    expect(codeOf(() => checkDemoSeed(missing))).toBe("bad_seed (emails.subject)");

    const foreign = demoSeed();
    foreign.tables.delegates = [{ ...(foreign.tables.delegates[0] as DemoRow), org_id: uuid(2) }];
    expect(codeOf(() => checkDemoSeed(foreign))).toBe("foreign_org_row (delegates.org_id)");

    const two = demoSeed();
    two.tables.organizations = [...two.tables.organizations, row("organizations", { id: uuid(2) })];
    expect(codeOf(() => checkDemoSeed(two))).toBe("bad_seed (organizations.id)");
    const notUuid = demoSeed();
    notUuid.tables.organizations = [row("organizations", { id: "x'; drop table organizations; --" })];
    expect(codeOf(() => checkDemoSeed(notUuid))).toBe("bad_seed (organizations.id)");
  });
});

describe("the id map", () => {
  test("an id alone and an id inside text map; another UUID and a key stay", () => {
    const ids = new Map([[MAILBOX, "NEW"]]);
    expect(mapIdsInText(MAILBOX, ids)).toBe("NEW");
    expect(mapIdsInText(`ap:${MAILBOX.toUpperCase()}:x ${uuid(99)}`, ids)).toBe(`ap:NEW:x ${uuid(99)}`);
    expect(mapIdsInJson({ [MAILBOX]: [MAILBOX, { a: `k-${MAILBOX}`, n: 1, z: null }] }, ids)).toEqual({
      [MAILBOX]: ["NEW", { a: "k-NEW", n: 1, z: null }],
    });
  });
});

describe("buildImportRows", () => {
  const ctx = () => {
    let n = 1000;
    return {
      orgId: uuid(5000),
      ownerId: uuid(6000),
      now: new Date("2026-11-30T10:00:00.000Z"),
      newId: () => uuid(n++),
    };
  };

  test("every row id is new, every foreign key and org_id point into the new rows", () => {
    const seed = demoSeed();
    const { rows } = buildImportRows(seed, ctx());
    const oldIds = new Set(DEMO_TABLES.flatMap((table) => seed.tables[table].map((r) => String(r.id ?? ""))));
    const newIds = DEMO_TABLES.flatMap((table) => rows[table].map((r) => String(r.id ?? "")).filter((id) => id !== ""));
    expect(newIds.every((id) => !oldIds.has(id))).toBe(true);
    expect(new Set(newIds).size).toBe(newIds.length);
    expect(rows.organizations[0]).toMatchObject({
      id: uuid(5000),
      name: IMPORT_ORG_NAME,
      plan: "active",
      trial_ends_at: null,
    });
    for (const table of DEMO_TABLES.filter((t) => t !== "organizations")) {
      expect(rows[table].every((r) => r.org_id === uuid(5000))).toBe(true);
    }
    const [mailbox] = rows.mailboxes;
    const emails = new Set(rows.emails.map((r) => r.id));
    expect(rows.mailbox_settings[0]?.mailbox_id).toBe(mailbox?.id);
    expect(rows.emails.every((r) => r.mailbox_id === mailbox?.id)).toBe(true);
    expect(rows.email_headers.every((r) => emails.has(r.email_id))).toBe(true);
    const actionIds = new Set(rows.actions.map((r) => r.id));
    const [delegation] = rows.delegations;
    expect(actionIds.has(delegation?.draft_action_id)).toBe(true);
    expect(actionIds.has(delegation?.send_action_id)).toBe(true);
    expect(emails.has(delegation?.answered_email_id)).toBe(true);
    // Every user id is the new owner.
    expect(rows.triage_feedback[0]?.user_id).toBe(uuid(6000));
    expect(rows.actions.find((r) => r.type === "send")?.approved_by).toBe(uuid(6000));
    expect(rows.outbox.every((r) => r.user_id === uuid(6000))).toBe(true);
  });

  test("ids inside JSON columns and key columns are mapped (review T9)", () => {
    const { rows } = buildImportRows(demoSeed(), ctx());
    const send = rows.actions.find((r) => r.type === "send") as DemoRow;
    const draft = rows.actions.find((r) => r.type === "create_draft") as DemoRow;
    const delegation = rows.delegations[0] as DemoRow;
    const payload = send.payload as { delegation_id: string; nested: { id: string }[] };
    expect(payload.delegation_id).toBe(delegation.id as string);
    expect(payload.nested[0]?.id).toBe(draft.id as string);
    expect(send.idempotency_key).toBe(`${rows.emails[1]?.id}:send`);
    expect((rows.audit_log[0]?.data as { mailbox_id: string }).mailbox_id).toBe(rows.mailboxes[0]?.id as string);
    expect(rows.audit_log[0]?.actor).toBe(`user:${uuid(6000)}`);
    const sent = rows.outbox.find((r) => r.status === "sent") as DemoRow;
    expect(sent.dedup_key).toBe(`approval:${send.id}`);
    expect(sent.buttons).toEqual([[{ text: "OK", data: `ap:${send.id}` }]]);
    expect((sent.view as { action_id: string }).action_id).toBe(send.id as string);
    // No old id is left anywhere in the rows.
    const text = JSON.stringify(rows);
    for (const old of [MAILBOX, SEND, DRAFT, DELEGATION, EMAIL_DONE, USER, ORG]) expect(text).not.toContain(old);
  });

  test("the org is made safe: paused mailbox with a placeholder secret, open actions expired, open mail skipped, unsent outbox dropped", () => {
    const result = buildImportRows(demoSeed(), ctx());
    const { rows } = result;
    expect(rows.mailboxes[0]).toMatchObject({ status: "paused", auth_reason: null, send_via: "smtp" });
    expect(result.credentials).toEqual([
      {
        mailbox_id: rows.mailboxes[0]?.id,
        org_id: uuid(5000),
        secret_kind: "password",
        encrypted_secret: PLACEHOLDER_SECRET,
        key_version: 1,
      },
    ]);
    expect(rows.actions.find((r) => r.type === "send")).toMatchObject({
      status: "expired",
      status_reason: "demo_import",
      locked_at: null,
    });
    expect(rows.actions.find((r) => r.type === "create_draft")?.status).toBe("applied");
    expect(rows.emails.find((r) => r.id === rows.delegations[0]?.answered_email_id)).toMatchObject({
      status: "skipped",
      skip_reason: "demo_import",
      locked_at: null,
    });
    // The pending row and the edit of it are dropped; the sent row stays.
    expect(result.droppedOutbox).toBe(2);
    expect(rows.outbox.map((r) => r.status)).toEqual(["sent"]);
  });

  test("a parent comes before its child inside a table, though the file lists the child first", () => {
    const { rows } = buildImportRows(demoSeed(), ctx());
    expect(rows.actions.map((r) => r.type)).toEqual(["create_draft", "send"]);
  });

  test("a foreign key that points at no row of its parent table is a bad seed; so is a cycle", () => {
    const dangling = demoSeed();
    dangling.tables.email_headers = [
      row("email_headers", { email_id: uuid(777), org_id: ORG, attachments: [], links: [] }),
    ];
    expect(() => buildImportRows(dangling, ctx())).toThrow(DemoSeedError);
    const wrongTable = demoSeed();
    // A mailbox id in an email column: the id exists, but not in `emails`.
    wrongTable.tables.email_headers = [
      row("email_headers", { email_id: MAILBOX, org_id: ORG, attachments: [], links: [] }),
    ];
    expect(() => buildImportRows(wrongTable, ctx())).toThrow(DemoSeedError);
    const cycle = demoSeed();
    cycle.tables.actions = [
      row("actions", {
        id: DRAFT,
        org_id: ORG,
        email_id: EMAIL_DONE,
        status: "applied",
        depends_on_action_id: SEND,
        payload: {},
      }),
      row("actions", {
        id: SEND,
        org_id: ORG,
        email_id: EMAIL_DONE,
        status: "applied",
        depends_on_action_id: DRAFT,
        payload: {},
      }),
    ];
    expect(() => buildImportRows(cycle, ctx())).toThrow(DemoSeedError);
    const twice = demoSeed();
    twice.tables.delegates = [...twice.tables.delegates, ...twice.tables.delegates];
    expect(() => buildImportRows(twice, ctx())).toThrow(DemoSeedError);
  });
});

describe("the seed files", () => {
  test("a new file is written; an existing file is out_exists and keeps its text; a missing file reads as undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "f113-s15-files-"));
    try {
      const path = join(dir, "demo.json");
      writeNewSeedFile(path, "one");
      expect(readSeedFile(path)).toBe("one");
      expect(() => writeNewSeedFile(path, "two")).toThrow(DemoSeedError);
      expect(readSeedFile(path)).toBe("one");
      expect(readSeedFile(join(dir, "missing.json"))).toBeUndefined();
      // Only the owner reads or writes the file (umask can only remove more bits).
      expect(statSync(path).mode & 0o177).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
