import { parseArgs } from "node:util";

import { type CliDescription, userLocaleSchema, type UserLocale, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "org:member",
    summary: "Adds a member, ends member sessions or unlinks the SSO account of one member.",
    risk: "write",
    needs: ["db"],
    usage:
      "bun run org:member --org-id <uuid> --add --email <e> --display-name <n> [--role assistant|owner] [--lang pl|en] | --org-id <uuid> --user-id <uuid> --end-sessions [--only-sso] | --org-id <uuid> --user-id <uuid> --unlink-sso",
    exits: { 1: "the member command was refused or failed" },
  },
] satisfies readonly CliDescription[];

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

// Structure only. Exactly one command; every command names the organization (the member check uses it).
// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseOrgMemberArgs(argv: string[]): OrgMemberCommand {
  const { values } = parseArgs({
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
  });

  const orgId = values["org-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id is a uuid");
  const commands = [values.add, values["end-sessions"], values["unlink-sso"]].filter(Boolean);
  if (commands.length !== 1) throw new UsageError("give exactly one of --add, --end-sessions, --unlink-sso");
  const userId = values["user-id"];
  if (userId !== undefined && !z.uuid().safeParse(userId).success) throw new UsageError("--user-id is a uuid");
  const addOnly = [values.email, values["display-name"], values.role, values.lang];

  if (values.add) {
    if (userId !== undefined || values["only-sso"] !== undefined) {
      throw new UsageError("--add takes no --user-id and no --only-sso");
    }
    const email = values.email?.trim();
    const displayName = values["display-name"]?.trim();
    if (email === undefined || !EMAIL_SHAPE.test(email)) throw new UsageError("--email is an address");
    if (displayName === undefined || displayName === "") throw new UsageError("--display-name is needed");
    const role = values.role ?? "assistant";
    if (role !== "assistant" && role !== "owner") throw new UsageError("--role is assistant or owner");
    const lang = userLocaleSchema.safeParse(values.lang ?? "pl");
    if (!lang.success) throw new UsageError("--lang is pl or en");
    return { kind: "add", orgId, email, displayName, role, locale: lang.data };
  }

  if (userId === undefined) throw new UsageError("--user-id is needed");
  if (addOnly.some((value) => value !== undefined)) {
    throw new UsageError("--email, --display-name, --role and --lang are for --add");
  }
  if (values["end-sessions"]) return { kind: "end_sessions", orgId, userId, onlySso: values["only-sso"] === true };
  if (values["only-sso"] !== undefined) throw new UsageError("--only-sso is for --end-sessions");
  return { kind: "unlink_sso", orgId, userId };
}
