import { randomBytes, randomUUID } from "node:crypto";
import { format } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";

import {
  createMailOAuthClients,
  createOAuthTokens,
  openImapProvider,
  openMailboxProvider,
  syncMailbox,
  type MailOAuthClients,
  type MailOAuthProvider,
  type OAuthTokens,
} from "../../src/modules/mail";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { encodeOAuthSecret } from "../../src/modules/mail/oauth/secret-store";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import type { CliRawOutput } from "../../src/platform/cli";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { CliDeps } from "../../src/scripts/lib/mailbox-cli";
import { run as runAudit } from "../../src/scripts/mailbox-audit";
import { run as runBackfill } from "../../src/scripts/mailbox-backfill";
import { run as runSeed } from "../../src/scripts/mailbox-seed";
import { run as runSignals } from "../../src/scripts/mailbox-signals";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { webOrg, type WebOrg } from "./web-helpers";

// The operator CLIs on an OAuth mailbox (the provider smoke): `run(argv, deps)` in this process, the token endpoint is the fake token server,
// the mail is GreenMail (auth off: it takes any token). No real provider call. The password paths have their own subprocess tests.
const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const VERIFIER = "v".repeat(43);
const MAIL_HOST = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const IMAP_PORT = Number(process.env.TEST_IMAP_PORT ?? "3143");
const SMTP_PORT = Number(process.env.TEST_SMTP_PORT ?? "3025");
const HOSTS = {
  imap: { host: MAIL_HOST, port: IMAP_PORT },
  smtp: { host: MAIL_HOST, port: SMTP_PORT, security: "tls" as const },
};
const OWNER = "owner@x.test";

let fake: FakeMailOAuth;
let clients: MailOAuthClients;
let tokens: OAuthTokens;
let org: WebOrg;
let consoleLines: string[] = [];
let spies: Mock<(...args: unknown[]) => void>[] = [];

const configOf = () =>
  loadConfig({
    DATABASE_URL: "postgres://x",
    CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WEB_BASE_URL: "http://127.0.0.1:8081",
    WEB_AUTH_SECRET: "x".repeat(32),
    MAIL_OAUTH_MICROSOFT_CLIENT_ID: fake.clientId,
    MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: fake.clientSecret,
    MAIL_OAUTH_GOOGLE_CLIENT_ID: fake.clientId,
    MAIL_OAUTH_GOOGLE_CLIENT_SECRET: fake.clientSecret,
  });

beforeAll(async () => {
  fake = await startFakeMailOAuth();
  clients = createMailOAuthClients(configOf(), { specs: fake.specs(HOSTS) });
  tokens = createOAuthTokens({ pool: db, secrets, clients, now: () => new Date() });
});

afterAll(async () => {
  await fake.stop();
  await db.destroy();
});

beforeEach(async () => {
  org = await webOrg(db);
  fake.calls.length = 0;
  consoleLines = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleLines.push(format(...args));
    });
    spies.push(spy as unknown as Mock<(...args: unknown[]) => void>);
  }
});

afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
  await org.cleanup();
});

/** The lines a CLI printed through its `out`. */
function capture(): { out: CliRawOutput; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: {
      print: (text) => void stdout.push(text),
      fail: (text) => void stderr.push(text),
      raw: (text) => void stdout.push(text),
      write: (text) => void stdout.push(text),
      writeErr: (text) => void stderr.push(text),
      json: (value) => void stdout.push(JSON.stringify(value)),
    },
  };
}

const depsOf = (testAddress: string | undefined, out: CliRawOutput): CliDeps => ({
  db,
  secrets,
  oauthTokens: tokens,
  testAddress,
  out,
});

interface Box {
  id: string;
  address: string;
  refreshToken: string;
}

/** A mailbox with an `oauth` secret that the fake token server knows (a real redeem). */
async function oauthMailbox(provider: MailOAuthProvider = "google"): Promise<Box> {
  const id = randomUUID();
  const address = `cli-${randomUUID()}@x.test`;
  const client = clients[provider];
  if (client === undefined) throw new Error("no client");
  const answer = await client.redeemCode(fake.code({ provider, address }), VERIFIER);
  const refreshToken = answer.refreshToken ?? "";
  fake.calls.length = 0;
  const ctx = { orgId: org.orgId };
  await insertMailbox(db, ctx, {
    id,
    address,
    imapHost: HOSTS.imap.host,
    imapPort: HOSTS.imap.port,
    smtpHost: HOSTS.smtp.host,
    smtpPort: HOSTS.smtp.port,
    capabilities: testCapabilities,
    folderMap: {},
    oauthProvider: provider,
    sendVia: provider === "microsoft" ? "graph" : "smtp",
  });
  await insertInboxFolder(db, ctx, id);
  const sealed = secrets.encrypt(
    encodeOAuthSecret({ v: 1, provider, refreshToken, tenantId: null, scopes: ["s"] }),
    `mailbox:${id}`
  );
  await insertCredentials(db, ctx, {
    mailboxId: id,
    encryptedSecret: sealed.ciphertext,
    secretKind: "oauth",
    keyVersion: sealed.keyVersion,
  });
  return { id, address, refreshToken };
}

/** The From and To of every INBOX mail of the mailbox, in arrival order. */
async function inboxHeaders(box: Box): Promise<{ from: string; fromName: string; to: string[] }[]> {
  const client = await connectImapClient({
    host: HOSTS.imap.host,
    port: HOSTS.imap.port,
    user: box.address,
    auth: { kind: "password", password: "any" },
  });
  try {
    const found: { from: string; fromName: string; to: string[] }[] = [];
    const lock = await client.getMailboxLock("INBOX");
    try {
      if (client.mailbox && client.mailbox.exists === 0) return found;
      for await (const message of client.fetch("1:*", { envelope: true })) {
        found.push({
          from: message.envelope?.from?.[0]?.address ?? "",
          fromName: message.envelope?.from?.[0]?.name ?? "",
          to: (message.envelope?.to ?? []).map((entry) => entry.address ?? ""),
        });
      }
    } finally {
      lock.release();
    }
    return found;
  } finally {
    await client.logout();
  }
}

const mailboxArgs = (box: Box) => ["--org-id", org.orgId, "--mailbox-id", box.id];
const statusOf = (id: string) =>
  db
    .selectFrom("mailboxes")
    .select(["status", "auth_reason", "status_changed_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
const plusNumbers = (rows: { from: string }[]) =>
  rows.map((row) => Number(/^owner\+ea-smoke-(\d+)@x\.test$/.exec(row.from)?.[1])).sort((a, b) => a - b);

describe("mailbox:seed on a Google OAuth mailbox", () => {
  test("3. 15 synthetic + 5 delegation mails: every From is an owner plus address, numbers 01-20 do not repeat", async () => {
    const box = await oauthMailbox("google");
    const cli = capture();
    const deps = depsOf(box.address, cli.out);
    const first = await runSeed(
      [...mailboxArgs(box), "--eval-cases", "synthetic", "--per-category", "3", "--from-owner", OWNER],
      deps
    );
    const second = await runSeed(
      [
        ...mailboxArgs(box),
        "--eval-cases",
        "delegation",
        "--per-category",
        "5",
        "--from-owner",
        OWNER,
        "--number-from",
        "16",
      ],
      deps
    );

    expect([first, second]).toEqual([0, 0]);
    expect(cli.stdout).toEqual(["appended 15", "appended 5"]);
    expect(cli.stderr).toEqual([]);
    const rows = await inboxHeaders(box);
    expect(rows).toHaveLength(20);
    expect(plusNumbers(rows)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const row of rows) {
      expect(row.from).toMatch(/^owner\+ea-smoke-\d{2}@x\.test$/);
      expect(row.to).toEqual([box.address]);
    }
    // The display name of the case stays.
    expect(rows.every((row) => row.fromName !== "")).toBe(true);
    // The mail was fetched with an access token from the fake token server (a refresh), not with a password.
    expect(fake.calls.filter((call) => call.grant === "refresh_token").length).toBeGreaterThan(0);
  });

  test("a list in TEST_MAILBOX_ADDRESS admits the mailbox and To is the mailbox; an address outside the list is refused", async () => {
    const box = await oauthMailbox("google");
    const args = [...mailboxArgs(box), "--eval-cases", "synthetic", "--per-category", "1", "--from-owner", OWNER];
    const ok = capture();
    expect(await runSeed(args, depsOf(`a@x.test, ${box.address}`, ok.out))).toBe(0);
    const rows = await inboxHeaders(box);
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.to).toEqual([box.address]);

    const refused = capture();
    expect(await runSeed(args, depsOf("a@x.test, b@x.test", refused.out))).toBe(1);
    expect(refused.stderr.join("\n")).toContain("not the test mailbox");
    expect(await inboxHeaders(box)).toHaveLength(5);
  });

  test("4. without --from-owner: exit 1 with the refusal text, and nothing is appended", async () => {
    const box = await oauthMailbox("google");
    const cli = capture();

    const code = await runSeed(
      [...mailboxArgs(box), "--eval-cases", "synthetic", "--per-category", "3"],
      depsOf(box.address, cli.out)
    );

    expect(code).toBe(1);
    expect(cli.stderr).toEqual(["failed: --from-owner is required for a real provider mailbox"]);
    expect(cli.stdout).toEqual([]);
    expect(await inboxHeaders(box)).toEqual([]);
    // The refusal comes before any token request.
    expect(fake.calls).toEqual([]);
  });

  test("a bad --from-owner is a usage error and appends nothing", async () => {
    const box = await oauthMailbox("google");
    const cli = capture();
    expect(await runSeed([...mailboxArgs(box), "--from-owner", "owner"], depsOf(box.address, cli.out))).toBe(1);
    expect(cli.stderr.join("\n")).toContain("usage: bun run mailbox:seed");
    expect(await inboxHeaders(box)).toEqual([]);
  });
});

describe("the other operator CLIs on an OAuth mailbox", () => {
  async function syncedBox(): Promise<Box> {
    const box = await oauthMailbox("google");
    const seeded = capture();
    expect(
      await runSeed([...mailboxArgs(box), "--count", "2", "--from-owner", OWNER], depsOf(box.address, seeded.out))
    ).toBe(0);
    const { provider } = await openMailboxProvider(
      { db, secrets, openProvider: openImapProvider, oauthTokens: tokens },
      { orgId: org.orgId },
      box.id
    );
    try {
      await syncMailbox(
        { db, provider, isOwnActionId: async () => false, now: () => new Date() },
        { orgId: org.orgId },
        box.id
      );
    } finally {
      await provider.close();
    }
    return box;
  }
  const since = () => new Date(Date.now() - 3_600_000).toISOString();

  test("5. mailbox:audit after one sync: exit 0, the mail is stored", async () => {
    const box = await syncedBox();
    const cli = capture();

    const code = await runAudit([...mailboxArgs(box), "--since", since()], depsOf(box.address, cli.out));

    expect(code).toBe(0);
    expect(cli.stdout[0]).toBe("inbox=2 stored=2 missing=0 duplicates=0 cross=0");
    expect(cli.stderr).toEqual([]);
  });

  test("mailbox:signals and mailbox:backfill open the OAuth mailbox with its access token", async () => {
    const box = await syncedBox();
    const signals = capture();
    expect(await runSignals([...mailboxArgs(box), "--days", "1"], depsOf(box.address, signals.out))).toBe(0);
    expect(signals.stdout.join("\n")).toContain("mails 2");
    const backfill = capture();
    expect(await runBackfill([...mailboxArgs(box), "--days", "1"], depsOf(box.address, backfill.out))).toBe(0);
    expect(backfill.stdout[0]).toContain("backfill");
    expect(backfill.stderr).toEqual([]);
  });

  test("6. a refused refresh (invalid_grant) in mailbox:audit: exit 1 with oauth_expired, status unchanged", async () => {
    const box = await syncedBox();
    // A new token store: the cache of the first one holds a token.
    const cold = createOAuthTokens({ pool: db, secrets, clients, now: () => new Date() });
    const before = await statusOf(box.id);
    fake.failNext({ status: 400, error: "invalid_grant" });
    const cli = capture();

    const code = await runAudit([...mailboxArgs(box), "--since", since()], {
      ...depsOf(box.address, cli.out),
      oauthTokens: cold,
    });

    expect(code).toBe(1);
    expect(cli.stderr).toEqual(["failed: oauth_expired"]);
    expect(cli.stdout).toEqual([]);
    expect(await statusOf(box.id)).toEqual(before);
    expect(before.status).toBe("active");
  });

  test("a refused refresh in mailbox:seed, mailbox:signals and mailbox:backfill prints the reason and changes no status", async () => {
    const box = await oauthMailbox("google");
    const before = await statusOf(box.id);
    const args = [...mailboxArgs(box)];
    const runs: { name: string; call: (deps: CliDeps) => Promise<number> }[] = [
      { name: "seed", call: (deps) => runSeed([...args, "--count", "1", "--from-owner", OWNER], deps) },
      { name: "signals", call: (deps) => runSignals(args, deps) },
      { name: "backfill", call: (deps) => runBackfill(args, deps) },
    ];
    for (const item of runs) {
      const cli = capture();
      fake.failNext({ status: 400, error: "invalid_grant" });
      const cold = createOAuthTokens({ pool: db, secrets, clients, now: () => new Date() });
      expect(await item.call({ ...depsOf(box.address, cli.out), oauthTokens: cold })).toBe(1);
      expect(cli.stderr).toEqual(["failed: oauth_expired"]);
      expect(await statusOf(box.id)).toEqual(before);
    }
  });

  test("7. canary: no token, refresh token, client secret or code in any CLI output or console line", async () => {
    const box = await syncedBox();
    const cli = capture();
    const cold = () => createOAuthTokens({ pool: db, secrets, clients, now: () => new Date() });
    await runAudit([...mailboxArgs(box), "--since", since()], { ...depsOf(box.address, cli.out), oauthTokens: cold() });
    await runSignals([...mailboxArgs(box), "--days", "1"], { ...depsOf(box.address, cli.out), oauthTokens: cold() });
    await runBackfill([...mailboxArgs(box), "--days", "1"], { ...depsOf(box.address, cli.out), oauthTokens: cold() });
    await runSeed([...mailboxArgs(box), "--count", "1", "--from-owner", OWNER], {
      ...depsOf(box.address, cli.out),
      oauthTokens: cold(),
    });
    fake.failNext({ status: 400, error: "invalid_grant", description: `bad grant ${box.refreshToken}` });
    await runAudit([...mailboxArgs(box), "--since", since()], { ...depsOf(box.address, cli.out), oauthTokens: cold() });

    const text = [...cli.stdout, ...cli.stderr, ...consoleLines].join("\n");
    expect(fake.issuedRefreshTokens.length).toBeGreaterThan(0);
    for (const secret of [box.refreshToken, fake.clientSecret, ...fake.issuedRefreshTokens]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/\bat-\d+-[0-9a-f]{12}\b/);
  });
});
