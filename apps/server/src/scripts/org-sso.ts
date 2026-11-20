import { resolveTxt } from "node:dns/promises";

import { EXIT } from "@ea/core";

import {
  attestSsoDomain,
  configureFeatures,
  getOrganization,
  getSsoState,
  isFeatureOn,
  normalizeMailDomain,
  removeSsoProvider,
  setSsoProvider,
  setSsoRequired,
  ssoDomainKey,
  ssoDomainRecord,
  verifySsoDomain,
} from "../modules/tenancy";
import { buildOidcConfig, discoverProviderConfig } from "../platform/auth-sso";
import { type CliSpec, exitCodeOf, runCli } from "../platform/cli";
import { featuresOff, loadConfig } from "../platform/config";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { describeError } from "../platform/errors";
import type { LookupAll } from "../platform/net-address";
import { dnsLookupAll } from "../platform/net-address";

import { cliDescriptions, parseOrgSsoArgs } from "./org-sso-args";

const ACTOR = "cli";
const DISCOVERY_TIMEOUT_MS = 10_000;

export interface OrgSsoDeps {
  db: Db;
  // One line of stdin, for the client secret. The CLI never takes the secret as an argument.
  readStdinLine: () => Promise<string>;
  out: (line: string) => void;
  err: (line: string) => void;
  // Origins where `http:` is allowed and discovery skips the DNS check. Empty in production; a test passes the fake IdP.
  allowOrigins: readonly string[];
  lookup: LookupAll;
  now: () => Date;
  // The TXT read of the domain proof (`node:dns/promises` `resolveTxt` in the entry, a fake in tests).
  resolveTxt: (name: string) => Promise<string[][]>;
  // `ssoDomainKey(CREDENTIALS_KEY)`: the key of the proof token.
  domainKey: Buffer;
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
// Returns the exit code. A bad argument throws a `UsageError` (`runCli` maps it to exit 2).
export async function runOrgSso(argv: string[], deps: OrgSsoDeps): Promise<number> {
  const command = parseOrgSsoArgs(argv, { allowOrigins: deps.allowOrigins });
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
        if (state.proof === null) {
          // The token is a keyed hash for a public DNS record, not a secret.
          const record = ssoDomainRecord(deps.domainKey, ctx.orgId, state.domain);
          deps.out(`txt ${record.name} ${record.value}`);
        }
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
        // `db`, never an open transaction: after a unique violation a transaction is aborted.
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

      case "verify": {
        if (!(await getOrganization(deps.db, ctx))) {
          deps.err("error organization_not_found");
          return 1;
        }
        const result = await verifySsoDomain(deps.db, ctx, {
          resolveTxt: deps.resolveTxt,
          key: deps.domainKey,
          actor: ACTOR,
          now: deps.now(),
        });
        if (result.kind === "not_found_in_dns") {
          deps.err("error not_found_in_dns");
          return 1;
        }
        deps.out(result.kind);
        return 0;
      }

      case "attest": {
        if (!(await getOrganization(deps.db, ctx))) {
          deps.err("error organization_not_found");
          return 1;
        }
        const result = await attestSsoDomain(deps.db, ctx, {
          confirmDomain: command.confirm,
          actor: ACTOR,
          now: deps.now(),
        });
        if (result.kind === "confirm_mismatch") {
          deps.err("error confirm_mismatch");
          return 1;
        }
        deps.out(result.kind);
        return 0;
      }

      case "require": {
        if (!(await getOrganization(deps.db, ctx))) {
          deps.err("error organization_not_found");
          return 1;
        }
        const result = await setSsoRequired(deps.db, ctx, {
          required: command.required,
          actor: ACTOR,
          now: deps.now(),
        });
        if (result.kind === "refused") {
          for (const reason of result.reasons) deps.err(`refused ${reason}`);
          for (const userId of result.userIds) deps.err(`member ${userId}`);
          return 1;
        }
        deps.out(`required ${yesNo(command.required)}`);
        return 0;
      }
      case "remove": {
        if (!(await getOrganization(deps.db, ctx))) {
          deps.err("error organization_not_found");
          return 1;
        }
        // The service compares the confirmed domain under the organization lock (a read here would race with a set).
        const result = await removeSsoProvider(deps.db, ctx, {
          actor: ACTOR,
          now: deps.now(),
          confirmDomain: command.confirm,
        });
        switch (result.kind) {
          case "confirm_mismatch":
            deps.err("error confirm_mismatch");
            return 1;
          case "removed":
            deps.out(`removed links_removed=${result.linksRemoved} sessions_ended=${result.sessionsEnded}`);
            return 0;
          case "none":
            deps.out("none");
            return 0;
        }
      }
    }
  } catch (error) {
    // The name and the code only. The message and the Postgres `detail` of a failed CHECK hold `oidc_config`, which holds the
    // client secret.
    deps.err(`error failed ${describeError(error)}`);
    return exitCodeOf(error);
  }
}

async function readStdinLine(): Promise<string> {
  const text = await Bun.stdin.text();
  return text.split("\n")[0] ?? "";
}

const main: CliSpec["main"] = async (argv, cli) => {
  // The parse comes first: `--help` and a bad flag need no config. `runOrgSso` parses again. Production allows no `http:` origin.
  parseOrgSsoArgs(argv, { allowOrigins: [] });
  const config = loadConfig();
  configureFeatures({ off: featuresOff(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    return await runOrgSso(argv, {
      db,
      readStdinLine,
      out: (line) => cli.print(line),
      err: (line) => cli.fail(line),
      allowOrigins: [],
      lookup: dnsLookupAll,
      now: () => new Date(),
      resolveTxt,
      domainKey: ssoDomainKey(config.CREDENTIALS_KEY),
      webBaseUrl: config.WEB_BASE_URL,
    });
  } catch (error) {
    const code = exitCodeOf(error);
    cli.fail(
      code === EXIT.unreachable ? `unreachable: ${describeError(error)}` : `error failed ${describeError(error)}`
    );
    return code;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "org-sso", descriptions: cliDescriptions, main });
}
