import { parseArgs } from "node:util";

import { z } from "zod";

export const usage =
  "usage: bun run org:sso --org-id <uuid> [--set --issuer <url> --domain <domain> --client-id <id> --client-secret-stdin | --remove --confirm <domain>]";

export type OrgSsoCommand =
  | { kind: "show"; orgId: string }
  | { kind: "set"; orgId: string; issuer: string; domain: string; clientId: string }
  | { kind: "remove"; orgId: string; confirm: string };

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
// exists (D10). null on any bad argument.
export function parseOrgSsoArgs(argv: string[], options: { allowOrigins: readonly string[] }): OrgSsoCommand | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        set: { type: "boolean" },
        remove: { type: "boolean" },
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
  if (values.set && values.remove) return null;
  const setOnly = [values.issuer, values.domain, values["client-id"], values["client-secret-stdin"]];

  if (values.set) {
    const { issuer, domain, "client-id": clientId } = values;
    if (values.confirm !== undefined || values["client-secret-stdin"] !== true) return null;
    if (issuer === undefined || domain === undefined || clientId === undefined) return null;
    if (domain.trim() === "" || clientId === "" || !isAcceptedIssuer(issuer, options.allowOrigins)) return null;
    return { kind: "set", orgId, issuer, domain, clientId };
  }

  if (setOnly.some((value) => value !== undefined)) return null;
  if (values.remove) {
    if (values.confirm === undefined || values.confirm.trim() === "") return null;
    return { kind: "remove", orgId, confirm: values.confirm };
  }
  return values.confirm === undefined ? { kind: "show", orgId } : null;
}
