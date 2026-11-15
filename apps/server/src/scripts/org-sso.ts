import {
  getOrganization,
  getSsoState,
  isFeatureOn,
  normalizeMailDomain,
  removeSsoProvider,
  setSsoProvider,
  configureFeatures,
} from "../modules/tenancy";
import { buildOidcConfig, discoverProviderConfig } from "../platform/auth-sso";
import { createCliOutput } from "../platform/cli";
import { featuresOff, loadConfig } from "../platform/config";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { describeError } from "../platform/errors";
import type { LookupAll } from "../platform/net-address";
import { dnsLookupAll } from "../platform/net-address";

import { parseOrgSsoArgs, usage } from "./org-sso-args";

const ACTOR = "cli";
const DISCOVERY_TIMEOUT_MS = 10_000;

export interface OrgSsoDeps {
  db: Db;
  // One line of stdin, for the client secret. The CLI never takes the secret as an argument (D10).
  readStdinLine: () => Promise<string>;
  out: (line: string) => void;
  err: (line: string) => void;
  // Origins where `http:` is allowed and discovery skips the DNS check. Empty in production; a test passes the fake IdP.
  allowOrigins: readonly string[];
  lookup: LookupAll;
  now: () => Date;
  // `WEB_BASE_URL`; undefined = the web is off.
  webBaseUrl: string | undefined;
}

const yesNo = (value: boolean): string => (value ? "yes" : "no");

function redirectLine(deps: OrgSsoDeps, providerId: string): string {
  const path = `/api/auth/sso/callback/${providerId}`;
  return deps.webBaseUrl === undefined
    ? `redirect ${path} (WEB_BASE_URL is not set)`
    : `redirect ${deps.webBaseUrl}${path}`;
}

function issuerHost(issuer: string): string {
  try {
    return new URL(issuer).host;
  } catch {
    return "invalid";
  }
}

// Prints ids, hosts, domains, counts and codes only: never the client secret, the provider config or an error message.
// Returns the exit code.
export async function runOrgSso(argv: string[], deps: OrgSsoDeps): Promise<number> {
  const command = parseOrgSsoArgs(argv, { allowOrigins: deps.allowOrigins });
  if (!command) {
    deps.err(usage);
    return 1;
  }
  const ctx = { orgId: command.orgId };

  try {
    switch (command.kind) {
      case "show": {
        if (!(await getOrganization(deps.db, ctx))) {
          deps.err("error organization_not_found");
          return 1;
        }
        const state = await getSsoState(deps.db, ctx);
        if (!state) {
          deps.out("no provider");
          return 0;
        }
        const on = await isFeatureOn(deps.db, ctx, "sso_sign_in");
        deps.out(`provider ${state.providerId}`);
        deps.out(`issuer ${issuerHost(state.issuer)}`);
        deps.out(`domain ${state.domain} ${state.proof === null ? "unproved" : "proof"}`);
        deps.out(`required ${yesNo(state.required)}`);
        deps.out(`flag sso_sign_in ${on ? "on" : "off"}`);
        deps.out(`break-glass ${state.breakGlassReady ? "ready" : "missing"}`);
        deps.out(`linked ${state.linkedMembers}`);
        deps.out(redirectLine(deps, state.providerId));
        return 0;
      }

      case "set": {
        const clientSecret = (await deps.readStdinLine()).trim();
        if (clientSecret === "") {
          deps.err("error client_secret_missing");
          return 1;
        }
        const domain = normalizeMailDomain(command.domain);
        if (domain === null) {
          deps.err("error bad_domain");
          return 1;
        }
        const found = await discoverProviderConfig(command.issuer, {
          allowOrigins: deps.allowOrigins,
          timeoutMs: DISCOVERY_TIMEOUT_MS,
          lookup: deps.lookup,
        });
        if (found.kind !== "ok") {
          deps.err(`error discovery_failed ${found.code}`);
          return 1;
        }
        const oidcConfig = buildOidcConfig(found.discovered, { clientId: command.clientId, clientSecret });
        // `db`, never an open transaction: after a unique violation a transaction is aborted (stage 07 review N4).
        const result = await setSsoProvider(deps.db, ctx, {
          issuer: command.issuer,
          domain,
          clientId: command.clientId,
          oidcConfig,
          actor: ACTOR,
          now: deps.now(),
        });
        switch (result.kind) {
          case "not_found":
            deps.err("error organization_not_found");
            return 1;
          case "domain_taken":
            deps.err("error domain_taken");
            return 1;
          case "domain_invalid":
            deps.err("error bad_domain");
            return 1;
          case "boundary":
            deps.out(`set boundary links_removed=${result.linksRemoved} sessions_ended=${result.sessionsEnded}`);
            break;
          default:
            deps.out(`set ${result.kind}`);
        }
        deps.out(redirectLine(deps, command.orgId));
        return 0;
      }

      case "remove": {
        const state = await getSsoState(deps.db, ctx);
        if (!state) {
          deps.out("none");
          return 0;
        }
        if (state.domain !== command.confirm.trim().toLowerCase()) {
          deps.err("error confirm_mismatch");
          return 1;
        }
        const result = await removeSsoProvider(deps.db, ctx, { actor: ACTOR, now: deps.now() });
        deps.out(
          result.kind === "removed"
            ? `removed links_removed=${result.linksRemoved} sessions_ended=${result.sessionsEnded}`
            : "none"
        );
        return 0;
      }
    }
  } catch (error) {
    // The name and the code only. The message and the Postgres `detail` of a failed CHECK hold `oidc_config`, which holds the
    // client secret.
    deps.err(`error failed ${describeError(error)}`);
    return 1;
  }
}

async function readStdinLine(): Promise<string> {
  const text = await Bun.stdin.text();
  return text.split("\n")[0] ?? "";
}

async function main(): Promise<number> {
  const cli = createCliOutput("org-sso");
  const config = loadConfig();
  configureFeatures({ off: featuresOff(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    return await runOrgSso(process.argv.slice(2), {
      db,
      readStdinLine,
      out: (line) => cli.print(line),
      err: (line) => cli.fail(line),
      allowOrigins: [],
      lookup: dnsLookupAll,
      now: () => new Date(),
      webBaseUrl: config.WEB_BASE_URL,
    });
  } catch (error) {
    cli.fail(`error failed ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

if (import.meta.main) {
  process.exit(await main());
}
