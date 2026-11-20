import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "org:sso",
    summary: "Shows or changes the SSO provider, domain proof and sign-in rule of an organization.",
    risk: "write",
    needs: ["db", "dns"],
    usage:
      "bun run org:sso --org-id <uuid> [--set --issuer <url> --domain <domain> --client-id <id> --client-secret-stdin | --remove --confirm <domain> | --verify | --attest --confirm <domain> | --require on|off]",
    exits: { 1: "the command was refused or failed", 3: "the database did not answer" },
    outputNote: "`show` prints the DNS TXT record of the domain proof (a keyed hash, not a secret)",
  },
] satisfies readonly CliDescription[];

export type OrgSsoCommand =
  | { kind: "show"; orgId: string }
  | { kind: "set"; orgId: string; issuer: string; domain: string; clientId: string }
  | { kind: "remove"; orgId: string; confirm: string }
  | { kind: "verify"; orgId: string }
  | { kind: "attest"; orgId: string; confirm: string }
  | { kind: "require"; orgId: string; required: boolean };

// `https:` always; `http:` only for an origin in `allowOrigins`. The CLI entry passes an empty list, so no argument or env
// key opens `http:` in production (the tests pass the origin of the fake IdP).
function isAcceptedIssuer(issuer: string, allowOrigins: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return false;
  }
  return url.protocol === "https:" || (url.protocol === "http:" && allowOrigins.includes(url.origin));
}

// Structure only; the domain is normalized and checked by the runner. The secret never comes as a value: only `--client-secret-stdin`
// exists. Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseOrgSsoArgs(argv: string[], options: { allowOrigins: readonly string[] }): OrgSsoCommand {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      set: { type: "boolean" },
      remove: { type: "boolean" },
      verify: { type: "boolean" },
      attest: { type: "boolean" },
      require: { type: "string" },
      issuer: { type: "string" },
      domain: { type: "string" },
      "client-id": { type: "string" },
      "client-secret-stdin": { type: "boolean" },
      confirm: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const orgId = values["org-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id is a uuid");
  // At most one command; none is `show`.
  const commands = [values.set, values.remove, values.verify, values.attest, values.require !== undefined].filter(
    Boolean
  );
  if (commands.length > 1) throw new UsageError("give at most one of --set, --remove, --verify, --attest, --require");
  const setOnly = [values.issuer, values.domain, values["client-id"], values["client-secret-stdin"]];

  if (values.set) {
    const { issuer, domain, "client-id": clientId } = values;
    if (values.confirm !== undefined) throw new UsageError("--set takes no --confirm");
    if (values["client-secret-stdin"] !== true) throw new UsageError("--set needs --client-secret-stdin");
    if (issuer === undefined || domain === undefined || clientId === undefined) {
      throw new UsageError("--set needs --issuer, --domain and --client-id");
    }
    if (domain.trim() === "" || clientId === "") throw new UsageError("--domain and --client-id are needed");
    if (!isAcceptedIssuer(issuer, options.allowOrigins)) throw new UsageError("--issuer is an https url");
    return { kind: "set", orgId, issuer, domain, clientId };
  }

  if (setOnly.some((value) => value !== undefined)) {
    throw new UsageError("--issuer, --domain, --client-id and --client-secret-stdin are for --set");
  }
  if (values.remove || values.attest) {
    if (values.confirm === undefined || values.confirm.trim() === "")
      throw new UsageError("--confirm <domain> is needed");
    return values.remove
      ? { kind: "remove", orgId, confirm: values.confirm }
      : { kind: "attest", orgId, confirm: values.confirm };
  }
  if (values.confirm !== undefined) throw new UsageError("--confirm is for --remove and --attest");
  if (values.verify) return { kind: "verify", orgId };
  if (values.require !== undefined) {
    if (values.require !== "on" && values.require !== "off") throw new UsageError("--require is on or off");
    return { kind: "require", orgId, required: values.require === "on" };
  }
  return { kind: "show", orgId };
}
