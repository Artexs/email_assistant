import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { createOrganizationWithOwner, setOrgFeature, setSsoProvider, ssoDomainRecord } from "../../src/modules/tenancy";
import { buildOidcConfig, discoverProviderConfig } from "../../src/platform/auth-sso";
import { createDb, type Db } from "../../src/platform/db";
import type { LookupAll } from "../../src/platform/net-address";
import { runOrgSso, type OrgSsoDeps } from "../../src/scripts/org-sso";
import { startFakeOidc, type FakeOidc } from "../fake-oidc";

import { testDb } from "./helpers";

// `org:sso` show, set and remove. `runOrgSso` runs in process,
// against the fake IdP. The real entry runs as a child process for the usage and the stream checks.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-sso.ts");
const WEB = "https://app.example.test";
const SECRET = "s3cret-value-1";
const NOW = new Date("2026-11-15T10:00:00.000Z");
const DOMAIN_KEY = Buffer.alloc(32, 9);

let fake: FakeOidc;
const orgIds: string[] = [];
const userIds: string[] = [];
const logged: string[] = [];
// Every line the CLI printed (stdout and stderr) and every log line, for the secret search of test 8.
const printed: string[] = [];
const spies: ReturnType<typeof spyOn>[] = [];

beforeAll(async () => {
  fake = await startFakeOidc();
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      spyOn(console, method).mockImplementation(
        (...args: unknown[]): void => void logged.push(args.map(String).join(" "))
      )
    );
  }
});

afterEach(async () => {
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  for (const spy of spies) spy.mockRestore();
  fake.stop();
  await db.destroy();
});

const freshDomain = () => `d${randomUUID().replaceAll("-", "")}.x.test`;
const publicLookup: LookupAll = async () => [{ address: "93.184.216.34", family: 4 }];

interface Org {
  orgId: string;
  domain: string;
}

async function seedOrg(): Promise<Org> {
  const domain = freshDomain();
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Org sso cli org",
    timezone: "Europe/Warsaw",
    email: `ann@${domain}`,
    displayName: "Ann",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  return { orgId, domain };
}

interface Run {
  code: number;
  out: string[];
  err: string[];
}

async function cli(argv: string[], over: Partial<OrgSsoDeps> = {}, secret = `${SECRET}\n`): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOrgSso(argv, {
    db,
    readStdinLine: async () => secret,
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    allowOrigins: [fake.origin],
    lookup: publicLookup,
    now: () => NOW,
    resolveTxt: async () => {
      throw new Error("ENOTFOUND");
    },
    domainKey: DOMAIN_KEY,
    webBaseUrl: WEB,
    ...over,
  });
  printed.push(...out, ...err);
  return { code, out, err };
}

const setArgv = (org: Org, over: { issuer?: string; domain?: string; clientId?: string } = {}): string[] => [
  "--org-id",
  org.orgId,
  "--set",
  "--issuer",
  over.issuer ?? fake.issuer,
  "--domain",
  over.domain ?? org.domain,
  "--client-id",
  over.clientId ?? fake.clientId,
  "--client-secret-stdin",
];

async function discoverFake() {
  const found = await discoverProviderConfig(fake.issuer, { allowOrigins: [fake.origin], timeoutMs: 5000 });
  if (found.kind !== "ok") throw new Error(`discovery failed: ${found.code}`);
  return found.discovered;
}

const providerRows = (orgId: string) =>
  db.selectFrom("sso_providers").selectAll().where("org_id", "=", orgId).execute();

// `viaRun` starts the package script like the operator does (`bun run` echoes the command line on stderr); the other tests start the script file.
async function spawnEntry(
  args: string[],
  stdin = "",
  viaRun = false
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(viaRun ? ["bun", "run", "org:sso", ...args] : ["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(stdin);
  await proc.stdin.end();
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

describe("org:sso", () => {
  test("2. the real entry: a set without --org-id prints the usage on stderr, exit 2, no row; the script exists", async () => {
    const org = await seedOrg();
    const result = await spawnEntry(["--set", "--issuer", fake.issuer, "--client-secret-stdin"], `${SECRET}\n`);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage: bun run org:sso");
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(SECRET);
    expect(await providerRows(org.orgId)).toEqual([]);

    const pkg = (await Bun.file(resolve(repoRoot, "package.json")).json()) as { scripts: Record<string, string> };
    expect(pkg.scripts["org:sso"]).toBe("bun apps/server/src/scripts/org-sso.ts");
  });

  test("2b. the real entry: show prints on stdout only, with the prefix", async () => {
    const org = await seedOrg();
    const result = await spawnEntry(["--org-id", org.orgId]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[org-sso] no provider");
    expect(result.stderr).toBe("");
    const missing = await spawnEntry(["--org-id", "00000000-0000-4000-8000-000000000000"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("[org-sso] error organization_not_found");
  });

  test("2c. the real entry: http for an origin is refused (no allow-list in production)", async () => {
    const org = await seedOrg();
    const result = await spawnEntry(setArgv(org), `${SECRET}\n`);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage: bun run org:sso");
    expect(await providerRows(org.orgId)).toEqual([]);
  });

  test("3. set on org A: new, the redirect line; again: unchanged", async () => {
    const org = await seedOrg();
    const first = await cli(setArgv(org));
    expect(first.code).toBe(0);
    expect(first.out).toEqual(["set new", `redirect ${WEB}/api/auth/sso/callback/${org.orgId}`]);
    expect(first.err).toEqual([]);
    const second = await cli(setArgv(org));
    expect(second.code).toBe(0);
    expect(second.out[0]).toBe("set unchanged");
    expect(await providerRows(org.orgId)).toHaveLength(1);
  });

  test("4. show: the nine lines for org A (with the txt line while unproved), no provider for org B", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    expect((await cli(setArgv(orgA))).code).toBe(0);
    const record = ssoDomainRecord(DOMAIN_KEY, orgA.orgId, orgA.domain);
    const shown = await cli(["--org-id", orgA.orgId]);
    expect(shown.code).toBe(0);
    expect(shown.out).toEqual([
      `provider ${orgA.orgId}`,
      `issuer ${new URL(fake.issuer).host}`,
      `domain ${orgA.domain} unproved`,
      `txt ${record.name} ${record.value}`,
      "required no",
      "flag sso_sign_in off",
      "break-glass missing",
      "linked 0",
      `redirect ${WEB}/api/auth/sso/callback/${orgA.orgId}`,
    ]);
    const none = await cli(["--org-id", orgB.orgId]);
    expect(none.code).toBe(0);
    expect(none.out).toEqual(["no provider"]);
  });

  test("4b. show with the flag on, a link, break-glass ready and no WEB_BASE_URL", async () => {
    const org = await seedOrg();
    await cli(setArgv(org));
    const flag = await setOrgFeature(
      db,
      { orgId: org.orgId },
      { flag: "sso_sign_in", enabled: true, actor: "test", now: NOW }
    );
    expect(flag.kind).toBe("changed");
    const userId = userIds.at(-1);
    await sql`INSERT INTO auth_accounts (account_id, provider_id, user_id) VALUES (${`sub-${org.orgId}`}, ${org.orgId}, ${userId}::uuid)`.execute(
      db
    );
    await sql`UPDATE users SET two_factor_enabled = true WHERE id = ${userId}::uuid`.execute(db);
    await sql`UPDATE memberships SET break_glass = true WHERE org_id = ${org.orgId}::uuid AND user_id = ${userId}::uuid`.execute(
      db
    );
    const shown = await cli(["--org-id", org.orgId], { webBaseUrl: undefined });
    expect(shown.out).toContain("flag sso_sign_in on");
    expect(shown.out).toContain("linked 1");
    expect(shown.out).toContain("break-glass ready");
    expect(shown.out.at(-1)).toBe(`redirect /api/auth/sso/callback/${org.orgId} (WEB_BASE_URL is not set)`);
  });

  test("5. the secret is in oidc_config and in no output, log or audit row; empty stdin: client_secret_missing, no row", async () => {
    const org = await seedOrg();
    const before = logged.length;
    const set = await cli(setArgv(org));
    const show = await cli(["--org-id", org.orgId]);
    const [row] = await providerRows(org.orgId);
    expect((JSON.parse(row?.oidc_config ?? "{}") as { clientSecret?: string }).clientSecret).toBe(SECRET);
    for (const line of [...set.out, ...set.err, ...show.out, ...show.err, ...logged.slice(before)]) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("clientSecret");
    }
    expect(show.out.join("\n")).not.toContain("clientSecret");
    const audit = await sql<{ data: unknown }>`SELECT data FROM audit_log WHERE org_id = ${org.orgId}::uuid`.execute(
      db
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain(SECRET);

    const other = await seedOrg();
    for (const empty of ["", "\n", "  \n"]) {
      const result = await cli(setArgv(other), {}, empty);
      expect(result.code).toBe(1);
      expect(result.err).toEqual(["error client_secret_missing"]);
    }
    expect(await providerRows(other.orgId)).toEqual([]);
  });

  test("6. remove: a wrong --confirm keeps the row; the right one (trimmed, any case) removes; again: none", async () => {
    const org = await seedOrg();
    await cli(setArgv(org));
    const wrong = await cli(["--org-id", org.orgId, "--remove", "--confirm", "y.test"]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toEqual(["error confirm_mismatch"]);
    expect(await providerRows(org.orgId)).toHaveLength(1);

    const removed = await cli(["--org-id", org.orgId, "--remove", "--confirm", ` ${org.domain.toUpperCase()} `]);
    expect(removed.code).toBe(0);
    expect(removed.out).toEqual(["removed links_removed=0 sessions_ended=0"]);
    expect(await providerRows(org.orgId)).toEqual([]);

    const again = await cli(["--org-id", org.orgId, "--remove", "--confirm", org.domain]);
    expect(again.code).toBe(0);
    expect(again.out).toEqual(["none"]);
  });

  test("6b. remove on an unknown organization: error organization_not_found, exit 1, like show and set", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const result = await cli(["--org-id", missing, "--remove", "--confirm", "x.test"]);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.err).toEqual(["error organization_not_found"]);
  });

  test("6c. a set that changes the domain after the CLI began the remove: nothing is removed (the compare runs under the lock)", async () => {
    const org = await seedOrg();
    expect((await cli(setArgv(org))).code).toBe(0);
    const moved = freshDomain();
    let raced = false;
    // The first transaction the remove opens runs a competing set first: the domain changes after the operator confirmed the old one.
    const racing = new Proxy(db, {
      get(target, prop) {
        if (prop === "transaction") {
          return () => ({
            execute: async (fn: (trx: unknown) => Promise<unknown>) => {
              if (!raced) {
                raced = true;
                const found = await discoverFake();
                const competing = await setSsoProvider(
                  target,
                  { orgId: org.orgId },
                  {
                    issuer: fake.issuer,
                    domain: moved,
                    clientId: fake.clientId,
                    oidcConfig: buildOidcConfig(found, { clientId: fake.clientId, clientSecret: SECRET }),
                    actor: "test",
                    now: NOW,
                  }
                );
                expect(competing.kind).toBe("boundary");
              }
              return target.transaction().execute(fn as never);
            },
          });
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }) as unknown as Db;
    const result = await cli(["--org-id", org.orgId, "--remove", "--confirm", org.domain], { db: racing });
    expect(raced).toBe(true);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.err).toEqual(["error confirm_mismatch"]);
    const rows = await providerRows(org.orgId);
    expect(rows.map((row) => row.domain)).toEqual([moved]);
  });

  test("7. a bad domain, a stopped IdP, a private host: exit 1 with the code, nothing written; a taken domain", async () => {
    const org = await seedOrg();
    const bad = await cli(setArgv(org, { domain: "x..test" }));
    expect(bad.code).toBe(1);
    expect(bad.err).toEqual(["error bad_domain"]);

    const stopped = await startFakeOidc();
    const { issuer, origin } = stopped;
    stopped.stop();
    const down = await cli(setArgv(org, { issuer }), { allowOrigins: [origin] });
    expect(down.code).toBe(1);
    expect(down.err).toHaveLength(1);
    expect(down.err[0]).toMatch(/^error discovery_failed \S+$/);

    const privateHost = await cli(setArgv(org, { issuer: "https://idp.x.test" }), {
      lookup: async () => [{ address: "10.0.0.1", family: 4 }],
    });
    expect(privateHost.code).toBe(1);
    expect(privateHost.err).toEqual(["error discovery_failed discovery_private_host"]);
    expect(await providerRows(org.orgId)).toEqual([]);

    const other = await seedOrg();
    expect((await cli(setArgv(other))).code).toBe(0);
    const taken = await cli(setArgv(org, { domain: other.domain }));
    expect(taken.code).toBe(1);
    expect(taken.err).toEqual(["error domain_taken"]);
    expect(await providerRows(org.orgId)).toEqual([]);
  });

  test("7b. a missing organization: exit 1 for show and set", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const show = await cli(["--org-id", missing]);
    expect(show.code).toBe(1);
    expect(show.err).toEqual(["error organization_not_found"]);
    const set = await cli(setArgv({ orgId: missing, domain: freshDomain() }));
    expect(set.code).toBe(1);
    expect(set.err).toEqual(["error organization_not_found"]);
  });

  test("9. a database error prints the name and the code only: no message, no Postgres detail", async () => {
    const org = await seedOrg();
    // The detail of a failed CHECK lists the row, and the row holds `oidc_config` with the client secret.
    const failure = Object.assign(new Error(`new row violates a check, secret ${SECRET}`), {
      name: "DatabaseError",
      code: "23514",
      detail: `Failing row contains (${SECRET}, oidc_config, clientSecret)`,
    });
    const broken = new Proxy(
      {},
      {
        get() {
          throw failure;
        },
      }
    ) as unknown as Db;
    const commands: string[][] = [
      setArgv(org),
      ["--org-id", org.orgId],
      ["--org-id", org.orgId, "--remove", "--confirm", org.domain],
    ];
    for (const argv of commands) {
      const result = await cli(argv, { db: broken });
      expect(result.code).toBe(1);
      expect(result.out).toEqual([]);
      expect(result.err).toEqual(["error failed DatabaseError 23514"]);
    }
  });

  test("9b. a real Postgres CHECK failure (23514): name and code only; the migrator-role error holds the secret in its detail", async () => {
    const canary = "rev1ew-secret-zz9";
    const constraint = `org_sso_probe_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const admin = createDb(process.env.MIGRATOR_DATABASE_URL ?? "");
    const org = await seedOrg();
    try {
      await sql
        .raw(
          `ALTER TABLE sso_providers ADD CONSTRAINT ${constraint} CHECK (oidc_config NOT LIKE '%rev1ew-secret%') NOT VALID`
        )
        .execute(admin);
      // Proof that the guard has work to do: the raw error of this CHECK, as the migrator, carries the secret in `detail`.
      let rawDetail = "";
      try {
        await sql`INSERT INTO sso_providers (provider_id, org_id, issuer, domain, oidc_config)
          VALUES (${org.orgId}, ${org.orgId}::uuid, 'https://idp.x.test', ${org.domain}, ${`{"clientSecret":"${canary}"}`})`.execute(
          admin
        );
      } catch (error) {
        rawDetail = String((error as { detail?: unknown }).detail);
      }
      expect(rawDetail).toContain(canary);

      // The app role (RLS on: Postgres omits the row) and the migrator role (the detail lists the row).
      for (const handle of [db, admin]) {
        const before = logged.length;
        const result = await cli(setArgv(org), { db: handle }, `${canary}\n`);
        expect(result.code).toBe(1);
        expect(result.out).toEqual([]);
        expect(result.err).toHaveLength(1);
        expect(result.err[0]).toMatch(/^error failed \S+ 23514$/);
        for (const line of [...result.out, ...result.err, ...logged.slice(before)]) {
          expect(line).not.toContain(canary);
          expect(line).not.toContain("clientSecret");
          expect(line).not.toContain(constraint);
        }
        expect(await providerRows(org.orgId)).toEqual([]);
      }
    } finally {
      await sql.raw(`ALTER TABLE sso_providers DROP CONSTRAINT IF EXISTS ${constraint}`).execute(admin);
      await admin.destroy();
    }
  });

  test("10. set gives the provider service the db handle, not an open transaction (the 23505 answer needs a fresh transaction)", async () => {
    const org = await seedOrg();
    let reads = 0;
    const counting = new Proxy(db, {
      get(target, prop) {
        if (prop === "isTransaction") reads += 1;
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = await cli(setArgv(org), { db: counting });
    expect(result.out[0]).toBe("set new");
    // `setSsoProvider` reads `isTransaction` of what it gets. A transaction that the CLI opened would hide the read from this proxy.
    expect(reads).toBeGreaterThan(0);
  });

  test("8. the secret and the config are in no output line and no log line of the whole file", () => {
    expect(printed.length).toBeGreaterThan(10);
    for (const line of [...printed, ...logged]) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("oidc_config");
      expect(line).not.toContain("clientSecret");
    }
  });
});
