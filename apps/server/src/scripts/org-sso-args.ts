import { parseArgs } from "node:util";

import { z } from "zod";

export const usage =
  "usage: bun run org:sso --org-id <uuid> [--set --issuer <url> --domain <domain> --client-id <id> --client-secret-stdin | --remove --confirm <domain> | --verify | --attest --confirm <domain> | --require on|off]";

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
// exists. null on any bad argument.
export function parseOrgSsoArgs(argv: string[], options: { allowOrigins: readonly string[] }): OrgSsoCommand | null {
  let values;
  try {
    ({ values } = parseArgs({
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
    }));
  } catch {
    return null;
  }

  const orgId = values["org-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  // At most one command; none is `show`.
  const commands = [values.set, values.remove, values.verify, values.attest, values.require !== undefined].filter(
    Boolean
  );
  if (commands.length > 1) return null;
  const setOnly = [values.issuer, values.domain, values["client-id"], values["client-secret-stdin"]];

  if (values.set) {
    const { issuer, domain, "client-id": clientId } = values;
    if (values.confirm !== undefined || values["client-secret-stdin"] !== true) return null;
    if (issuer === undefined || domain === undefined || clientId === undefined) return null;
    if (domain.trim() === "" || clientId === "" || !isAcceptedIssuer(issuer, options.allowOrigins)) return null;
    return { kind: "set", orgId, issuer, domain, clientId };
  }

  if (setOnly.some((value) => value !== undefined)) return null;
  if (values.remove || values.attest) {
    if (values.confirm === undefined || values.confirm.trim() === "") return null;
    return values.remove
      ? { kind: "remove", orgId, confirm: values.confirm }
      : { kind: "attest", orgId, confirm: values.confirm };
  }
  if (values.confirm !== undefined) return null;
  if (values.verify) return { kind: "verify", orgId };
  if (values.require !== undefined) {
    if (values.require !== "on" && values.require !== "off") return null;
    return { kind: "require", orgId, required: values.require === "on" };
  }
  return { kind: "show", orgId };
}
