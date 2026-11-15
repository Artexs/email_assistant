import { parseArgs } from "node:util";

import { userLocaleSchema, type UserLocale } from "@ea/core";
import { z } from "zod";

export const usage =
  "usage: bun run org:member --org-id <uuid> --add --email <e> --display-name <n> [--role assistant|owner] [--lang pl|en] | --org-id <uuid> --user-id <uuid> --end-sessions [--only-sso] | --org-id <uuid> --user-id <uuid> --unlink-sso";

export type OrgMemberCommand =
  | {
      kind: "add";
      orgId: string;
      email: string;
      displayName: string;
      role: "assistant" | "owner";
      locale: UserLocale;
    }
  | { kind: "end_sessions"; orgId: string; userId: string; onlySso: boolean }
  | { kind: "unlink_sso"; orgId: string; userId: string };

// One `@`, no space, a dot in the domain: a shape check only, the verification mail never goes out for an SSO member.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// Structure only. Exactly one command; every command names the organization (the member check uses it). null on any bad argument.
export function parseOrgMemberArgs(argv: string[]): OrgMemberCommand | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        "user-id": { type: "string" },
        add: { type: "boolean" },
        "end-sessions": { type: "boolean" },
        "unlink-sso": { type: "boolean" },
        email: { type: "string" },
        "display-name": { type: "string" },
        role: { type: "string" },
        lang: { type: "string" },
        "only-sso": { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }

  const orgId = values["org-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  const commands = [values.add, values["end-sessions"], values["unlink-sso"]].filter(Boolean);
  if (commands.length !== 1) return null;
  const userId = values["user-id"];
  if (userId !== undefined && !z.uuid().safeParse(userId).success) return null;
  const addOnly = [values.email, values["display-name"], values.role, values.lang];

  if (values.add) {
    if (userId !== undefined || values["only-sso"] !== undefined) return null;
    const email = values.email?.trim();
    const displayName = values["display-name"]?.trim();
    if (email === undefined || !EMAIL_SHAPE.test(email)) return null;
    if (displayName === undefined || displayName === "") return null;
    const role = values.role ?? "assistant";
    if (role !== "assistant" && role !== "owner") return null;
    const lang = userLocaleSchema.safeParse(values.lang ?? "pl");
    if (!lang.success) return null;
    return { kind: "add", orgId, email, displayName, role, locale: lang.data };
  }

  if (userId === undefined || addOnly.some((value) => value !== undefined)) return null;
  if (values["end-sessions"]) return { kind: "end_sessions", orgId, userId, onlySso: values["only-sso"] === true };
  if (values["only-sso"] !== undefined) return null;
  return { kind: "unlink_sso", orgId, userId };
}
