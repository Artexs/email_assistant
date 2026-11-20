// Guards of the reference and explanation pages. Each number on a page is read from the code that owns it, so a change of
// the code fails here until the page says the same. The page text is read as source: the build checks the front matter and the links.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHASER_SET_LIMIT,
  DEFAULT_SEND_LIMITS,
  DEFAULT_THRESHOLD,
  DELEGATION_REMINDER_LIMIT,
  DIGEST_LATE_MS,
  DIGEST_MAX_LINES,
  featureFlags,
  GATE_BAR,
  GATE_MIN_KEPT,
  MAX_DIGEST_TIMES,
  MESSAGE_MAX_CHARS,
  QUIET_HOURS,
  SENDER_RULE_LIMIT,
  PROFILE_SIGNATURE_MAX,
  toolSwitchNames,
  UNDO_WINDOW_MS,
  APPROVAL_QUOTE_CHARS,
  barCategories,
  categories,
  evidenceKeySchema,
  type FeatureKey,
} from "@ea/core";

import { apiGroups, apiOperations, loadApiSpec, successAnswers } from "./api-reference";
import { autonomyEvidenceFacts } from "./autonomy-evidence";
import { flaggedTextProblems } from "./flagged-text";
import { geminiClaimProblems, geminiOutsideCondition } from "./gemini-text";
import { OWNER_REVIEW_PENDING } from "./publish-gate";
import { publicClaims } from "./security/claims";

import { APPROVAL_TTL_MS } from "../../server/src/modules/actions/constants";
import { CLAIM_MAX_AGE_MS } from "../../server/src/modules/actions/repo/claims";
import { SYNC_LATE_MS } from "../../server/src/modules/channels/notices/sync";
import { BOT_COMMANDS } from "../../server/src/modules/channels/telegram/polling";
import { LINK_TOKEN_TTL_MS } from "../../server/src/modules/channels/linking";
import { OUTBOX_MAX_AGE_MS } from "../../server/src/modules/channels/sender";
import { LOCKOUT_MAX_FAILURES, LOCKOUT_MS, LOCKOUT_WINDOW_MS } from "../../server/src/platform/auth-lockout";
import { HARD_ERROR_TRIES } from "../../server/src/modules/triage/service";

const ROOT = join(import.meta.dir, "../../..");
const DOCS = join(import.meta.dir, "content/docs");

function readPage(id: string): string {
  return readFileSync(join(DOCS, `${id}.mdx`), "utf8");
}

function readRepo(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

// The cells of the Markdown table rows of a page. The header row and the separator row have no backticked or plain first cell
// that a test asks for, so a test picks the rows it needs by their first cell.
function tableRows(source: string): string[][] {
  return source
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, line.lastIndexOf("|"))
        .split("|")
        .map((cell) => cell.trim())
    );
}

// A number that the code keeps in a constant that it does not export: read the first capture of a pattern in the source file.
function numberInSource(path: string, pattern: RegExp): number {
  const match = pattern.exec(readRepo(path));
  if (match?.[1] === undefined) throw new Error(`no match for ${String(pattern)} in ${path}`);
  return Number(match[1]);
}

function front(source: string): { capabilities: string[] } {
  const block = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
  const capabilities = [...block.matchAll(/^ {2}- (\S+)$/gm)].map((match) => match[1] ?? "");
  return { capabilities };
}

const hours = (ms: number): string => `${ms / 3_600_000} hours`;
const minutes = (ms: number): string => `${ms / 60_000} minutes`;
const days = (ms: number): string => `${ms / 86_400_000} days`;

// A command that a default-off flag gates stays off the page. A flag that defaults on moves the command to the page.
const COMMAND_FLAGS: Record<string, FeatureKey> = { review: "review_command" };

function commandsOnPage(source: string): string[] {
  return [...source.matchAll(/`\/([a-z_]+)`/g)].map((match) => match[1] ?? "");
}

describe("reference/telegram", () => {
  const page = readPage("reference/telegram");
  const names = BOT_COMMANDS.map((entry) => entry.command as string);
  const flagged = (name: string): boolean => {
    const flag = COMMAND_FLAGS[name];
    return flag !== undefined && featureFlags[flag].default === false;
  };

  test("T1 each command of BOT_COMMANDS without a default-off flag is on the page", () => {
    const missing = names.filter((name) => !flagged(name) && !commandsOnPage(page).includes(name));
    expect(missing).toEqual([]);
  });
  test("T1 each command on the page is in BOT_COMMANDS, except /start", () => {
    const unknown = commandsOnPage(page).filter((name) => name !== "start" && !names.includes(name));
    expect(unknown).toEqual([]);
  });
  test("T1 a command of a default-off flag is not on the page", () => {
    const shown = names.filter((name) => flagged(name) && commandsOnPage(page).includes(name));
    expect(shown).toEqual([]);
  });
  test("T1 the flag of a command is in the registry and names a command of the bot", () => {
    for (const [name, flag] of Object.entries(COMMAND_FLAGS)) {
      expect({ name, inBot: names.includes(name) }).toEqual({ name, inBot: true });
      expect(Object.hasOwn(featureFlags, flag)).toBe(true);
    }
  });
  test("each command has a row with its own name in the first cell", () => {
    const rows = tableRows(page).filter((cells) => /^`\/[a-z_]+`$/.test(cells[0] ?? ""));
    expect(rows.map((cells) => cells[0])).toEqual(names.filter((name) => !flagged(name)).map((name) => `\`/${name}\``));
  });
});

describe("reference/categories", () => {
  test("T2 the rows are exactly the categories of the system, in its order", () => {
    const rows = tableRows(readPage("reference/categories")).filter((cells) => /^`[a-z_]+`$/.test(cells[0] ?? ""));
    expect(rows.map((cells) => (cells[0] ?? "").replaceAll("`", ""))).toEqual([...categories]);
  });
  test("the limit of the unsure rule is the start limit of the code", () => {
    expect(readPage("reference/categories")).toContain(`The start limit is ${DEFAULT_THRESHOLD} for each category`);
  });
});

interface LimitRow {
  label: string;
  value: string;
  // The capability page that states the number (`docs/capabilities/<name>.md`); the page lists it in its front matter.
  capability: string;
}

// The value cell of each row of reference/limits, from the code that owns the number.
function limitRows(): LimitRow[] {
  return [
    { label: "Mails in one digest", value: `${DIGEST_MAX_LINES}`, capability: "digest-and-notices" },
    { label: "Characters in one digest", value: `${MESSAGE_MAX_CHARS}`, capability: "digest-and-notices" },
    { label: "Digest times for each member", value: `${MAX_DIGEST_TIMES}`, capability: "digest-and-notices" },
    { label: "Late digest", value: hours(DIGEST_LATE_MS), capability: "digest-and-notices" },
    {
      label: "Messages for you in one round",
      value: `${numberInSource("apps/server/src/modules/channels/sender.ts", /const DEFAULT_PER_USER_LIMIT = (\d+);/)}`,
      capability: "digest-and-notices",
    },
    { label: "Life of a message", value: hours(OUTBOX_MAX_AGE_MS), capability: "digest-and-notices" },
    { label: "Quiet hours", value: `${QUIET_HOURS.start} to ${QUIET_HOURS.end}`, capability: "digest-and-notices" },
    { label: "Late sync", value: minutes(SYNC_LATE_MS), capability: "digest-and-notices" },
    { label: "Link to Telegram", value: minutes(LINK_TOKEN_TTL_MS), capability: "digest-and-notices" },
    { label: "Time to approve a send", value: hours(APPROVAL_TTL_MS), capability: "drafts-and-send" },
    {
      label: "Sends for one mailbox in one hour",
      value: `${DEFAULT_SEND_LIMITS.mailboxHour}`,
      capability: "drafts-and-send",
    },
    {
      label: "Sends for one mailbox in 24 hours",
      value: `${DEFAULT_SEND_LIMITS.mailboxDay}`,
      capability: "drafts-and-send",
    },
    {
      label: "Sends to one recipient in 24 hours",
      value: `${DEFAULT_SEND_LIMITS.recipientDay}`,
      capability: "drafts-and-send",
    },
    {
      label: "Quote in an approval request",
      value: `${APPROVAL_QUOTE_CHARS} characters`,
      capability: "drafts-and-send",
    },
    { label: "Reminders in one set", value: `${CHASER_SET_LIMIT}`, capability: "delegation" },
    { label: "Reminders for one delegation", value: `${DELEGATION_REMINDER_LIMIT}`, capability: "delegation" },
    {
      label: "Age of mail that the system sorts",
      value: `${numberInSource("apps/server/src/modules/triage/service.ts", /const MAX_AGE_MS = (\d+) \* DAY_MS;/)} days`,
      capability: "triage",
    },
    { label: "Life of a planned change", value: hours(CLAIM_MAX_AGE_MS), capability: "actions-and-undo" },
    { label: "Undo window", value: days(UNDO_WINDOW_MS), capability: "actions-and-undo" },
    { label: "Start limit of confidence", value: `${DEFAULT_THRESHOLD}`, capability: "triage" },
    { label: "Tries before `unsure`", value: `${HARD_ERROR_TRIES}`, capability: "triage" },
    {
      label: "Go/no-go bar for auto",
      value: `${Math.round(GATE_BAR * 100)} % on ${GATE_MIN_KEPT} rated mails`,
      capability: "triage",
    },
    { label: "Sender rules", value: `${SENDER_RULE_LIMIT}`, capability: "triage" },
    {
      label: "Mailboxes",
      value: `${numberInSource("db/migrations/20261112100001_org_plan.sql", /max_mailboxes integer NOT NULL DEFAULT (\d+)/)}`,
      capability: "tenancy-and-plans",
    },
    {
      label: "Session",
      value: `${numberInSource("apps/server/src/platform/auth.ts", /expiresIn: 60 \* 60 \* 24 \* (\d+),/)} days`,
      capability: "web-panel",
    },
    {
      label: "Lockout",
      value: `${LOCKOUT_MAX_FAILURES} tries in ${minutes(LOCKOUT_WINDOW_MS)}`,
      capability: "web-panel",
    },
    {
      label: "Password length",
      value: `${numberInSource("apps/server/src/platform/auth.ts", /minPasswordLength: (\d+),/)} to ${numberInSource("apps/server/src/platform/auth.ts", /maxPasswordLength: (\d+),/)} characters`,
      capability: "web-panel",
    },
  ];
}

describe("reference/limits", () => {
  const page = readPage("reference/limits");
  const rows = tableRows(page).filter((cells) => cells.length === 3 && cells[0] !== "Limit");

  test("the rows are exactly the expected limits, in order", () => {
    expect(rows.map((cells) => cells[0])).toEqual(limitRows().map((row) => row.label));
  });
  test("each value is the value of the code", () => {
    const actual = rows.map((cells) => ({ label: cells[0], value: cells[1] }));
    const expected = limitRows().map((row) => ({ label: row.label, value: row.value }));
    expect(actual).toEqual(expected);
  });
  test("each row names a capability page that the page lists in its front matter, and that exists", () => {
    const listed = front(page).capabilities;
    for (const row of limitRows()) {
      expect({ label: row.label, listed: listed.includes(row.capability) }).toEqual({ label: row.label, listed: true });
      expect(() => readRepo(`docs/capabilities/${row.capability}.md`)).not.toThrow();
    }
  });
  test("the server keeps the same size of a reminder set as the core", () => {
    const set = rows.find((cells) => cells[0] === "Reminders in one set");
    const server = numberInSource(
      "apps/server/src/modules/delegation/chaser.ts",
      /export const CHASER_SET_LIMIT = (\d+);/
    );
    expect(set?.[1]).toBe(`${server}`);
  });
  test("the lockout row says how long the lock lasts", () => {
    const lockout = rows.find((cells) => cells[0] === "Lockout");
    expect(lockout?.[2]).toContain(`for ${minutes(LOCKOUT_MS)}`);
  });
});

describe("reference/settings", () => {
  const page = readPage("reference/settings");

  test("the page names each switch of the code by its panel label", () => {
    for (const name of toolSwitchNames) expect(page).toContain(`<UiText k="switch_${name}" />`);
    expect(page).toContain("Five switches");
    expect(toolSwitchNames).toHaveLength(5);
  });
  test("the page names the categories that have auto", () => {
    expect(page).toContain("Urgent, Needs reply, Info, Notifications and Spam");
    expect(barCategories).toEqual(["urgent", "needs_reply", "info", "notification", "spam"]);
  });
  test("the check of auto says the bar and the number of ratings of the code", () => {
    expect(page).toContain(`at least ${Math.round(GATE_BAR * 100)} % on at least ${GATE_MIN_KEPT} mails`);
    expect(page).toContain(`The start value is ${DEFAULT_THRESHOLD}`);
  });
  test("the digest times and the signature limits are the numbers of the code", () => {
    expect(page).toContain(`Up to ${MAX_DIGEST_TIMES} times of the day`);
    expect(page).toContain(`Text of up to ${PROFILE_SIGNATURE_MAX} characters`);
    expect(page).toContain(`You can undo each move for ${days(UNDO_WINDOW_MS)}.`);
  });
  test("the defaults come from the migrations", () => {
    expect(readRepo("db/migrations/20261103100001_mail.sql")).toContain("mode text NOT NULL DEFAULT 'shadow'");
    expect(readRepo("db/migrations/20261103100001_mail.sql")).toContain("tool_switches jsonb NOT NULL DEFAULT '{}'");
    expect(readRepo("db/migrations/20261106000001_telegram.sql")).toContain(
      "ALTER COLUMN digest_times SET DEFAULT '{08:00,16:00}'"
    );
    expect(page).toContain("08:00 and 16:00");
    expect(page).toContain("Shadow mode for a new mailbox");
  });
});

describe("explanation pages", () => {
  const ids = ["explanation/how-a-mail-is-sorted", "explanation/never-sends-alone", "explanation/shadow-and-assist"];
  const capabilities: Record<string, string[]> = {
    "explanation/how-a-mail-is-sorted": ["triage"],
    "explanation/never-sends-alone": ["drafts-and-send"],
    "explanation/shadow-and-assist": ["actions-and-undo", "triage", "measurement"],
    "reference/categories": ["triage", "actions-and-undo"],
    "reference/telegram": ["digest-and-notices", "drafts-and-send", "delegation"],
    "reference/settings": ["actions-and-undo", "web-panel", "sync"],
  };

  test("each page has 40 to 80 lines", () => {
    for (const id of ids) {
      const lines = readPage(id).trimEnd().split("\n").length;
      expect({ id, ok: lines >= 40 && lines <= 80 }).toEqual({ id, ok: true });
    }
  });
  test("each page lists the capabilities of the stage text", () => {
    for (const [id, expected] of Object.entries(capabilities)) {
      expect({ id, listed: expected.every((name) => front(readPage(id)).capabilities.includes(name)) }).toEqual({
        id,
        listed: true,
      });
    }
  });
  test("each explanation page links to a reference page", () => {
    for (const id of ids) {
      const page = readPage(id);
      expect({ id, reference: /\]\(\.\.\/\.\.\/reference\/[a-z-]+\/\)/.test(page) }).toEqual({ id, reference: true });
    }
  });
  test("the numbers of the explanation pages are the numbers of the code", () => {
    const sent = readPage("explanation/never-sends-alone");
    expect(sent).toContain(`If nobody taps within ${hours(APPROVAL_TTL_MS)}`);
    expect(sent).toContain(
      `${DEFAULT_SEND_LIMITS.mailboxHour} sends an hour and ${DEFAULT_SEND_LIMITS.mailboxDay} sends in 24 hours`
    );
    expect(sent).toContain(`${DEFAULT_SEND_LIMITS.recipientDay} sends to one recipient in 24 hours`);
    const sorted = readPage("explanation/how-a-mail-is-sorted");
    expect(sorted).toContain(`The start limit is ${DEFAULT_THRESHOLD}`);
    expect(sorted).toContain(
      `${numberInSource("apps/server/src/modules/triage/service.ts", /const MAX_AGE_MS = (\d+) \* DAY_MS;/)} days`
    );
    expect(HARD_ERROR_TRIES).toBe(3);
    expect(sorted).toContain("fails three times");
    const mode = readPage("explanation/shadow-and-assist");
    expect(mode).toContain(`at least ${Math.round(GATE_BAR * 100)} % on at least ${GATE_MIN_KEPT} mails`);
    expect(mode).toContain(`The Undo works for ${days(UNDO_WINDOW_MS)} after the change`);
  });
});

describe("reference/api", () => {
  const spec = loadApiSpec();
  const operations = apiOperations(spec);
  const fileOperations = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item ?? {}).map(([method, operation]) => ({
      path,
      method: method.toUpperCase(),
      id: operation.operationId,
    }))
  );

  test("T5 the page data holds every operation of the file once, under its operationId", () => {
    expect(operations.map((operation) => operation.operationId).sort()).toEqual(fileOperations.map((o) => o.id).sort());
    expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(fileOperations.length);
    expect(fileOperations.length).toBeGreaterThan(50);
    const groups = apiGroups(operations);
    expect(groups.flatMap((group) => group.operations).length).toBe(fileOperations.length);
  });
  test("T5 the groups are sorted by tag, and each by path", () => {
    const groups = apiGroups(operations);
    expect(groups.map((group) => group.tag)).toEqual(groups.map((group) => group.tag).sort());
    for (const group of groups) {
      const paths = group.operations.map((operation) => operation.path);
      expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    }
  });
  test("T5 an operation with two success answers (alsoOk) shows both statuses", () => {
    const doubles = operations.filter((operation) => successAnswers(operation).length > 1);
    expect(doubles.map((operation) => operation.operationId)).toContain("requestReply");
    for (const operation of doubles) {
      const fromFile = Object.keys(
        spec.paths[operation.path]?.[operation.method.toLowerCase()]?.responses ?? {}
      ).filter((s) => s.startsWith("2"));
      expect(successAnswers(operation).map((answer) => answer.status)).toEqual(fromFile);
      for (const answer of successAnswers(operation)) expect(answer.schemaName).not.toBeNull();
    }
  });
  test("every answer of the file shows its status, and a public route says so", () => {
    for (const operation of operations) {
      const fromFile = Object.keys(spec.paths[operation.path]?.[operation.method.toLowerCase()]?.responses ?? {});
      expect(operation.answers.map((answer) => answer.status)).toEqual(fromFile);
    }
    expect(operations.filter((operation) => operation.auth === "public").length).toBeGreaterThan(0);
  });
  test("the page names the session cookie, the feature sentence and the claim about the private network; no number is typed", () => {
    const page = readPage("reference/api");
    expect(page).toContain("session cookie");
    expect(page).toContain("Some routes answer only while an operator turns a feature on.");
    expect(page).toContain("](../../security/#claim-private-panel)");
    expect(publicClaims.map((claim) => claim.id)).toContain("private-panel");
    // Claims of reachability live only in `publicClaims`: the page makes none of its own.
    expect(page).not.toMatch(/tailscale|public address|reachable/i);
    expect(front(page).capabilities.length).toBeGreaterThan(0);
  });
  test("no sentence of the page names Gemini outside the condition: optional, off by default", () => {
    const text = JSON.stringify(spec) + readPage("reference/api");
    expect(geminiOutsideCondition([text])).toEqual([]);
    expect(geminiClaimProblems(text)).toEqual([]);
  });
});

describe("reference/autonomy-evidence", () => {
  const facts = autonomyEvidenceFacts();
  const text = (id: string): string => facts.find((fact) => fact.id === id)?.text ?? "";

  test("P6 the page has at least three facts, each with an id and a title", () => {
    expect(facts.length).toBeGreaterThanOrEqual(3);
    expect(new Set(facts.map((fact) => fact.id)).size).toBe(facts.length);
    for (const fact of facts) expect([fact.title, fact.text].every((part) => part.trim() !== "")).toBe(true);
  });
  test("T6 each number of the facts is the number of its constant", () => {
    expect(text("go-no-go-bar")).toContain(
      `at least ${Math.round(GATE_BAR * 100)} % on at least ${GATE_MIN_KEPT} mails`
    );
    expect(text("start-state")).toContain(`${barCategories.length} categories`);
    expect(text("start-state")).toContain(`limit of confidence is ${DEFAULT_THRESHOLD}`);
    expect(text("start-state")).toContain("starts in shadow mode");
    expect(text("ai-setup")).toContain(`has ${Object.keys(evidenceKeySchema.shape).length} parts`);
    expect(text("undo")).toContain(`undone for ${days(UNDO_WINDOW_MS)}`);
    expect(Object.keys(evidenceKeySchema.shape)).toEqual([
      "provider",
      "model",
      "reasoningEffort",
      "promptVersion",
      "promptParts",
      "endpoint",
      "host",
    ]);
  });
  test("T6 every number that a fact states is one of the checked numbers", () => {
    const allowed = new Set([
      `${Math.round(GATE_BAR * 100)}`,
      `${GATE_MIN_KEPT}`,
      `${barCategories.length}`,
      `${DEFAULT_THRESHOLD}`,
      `${Object.keys(evidenceKeySchema.shape).length}`,
      `${UNDO_WINDOW_MS / 86_400_000}`,
    ]);
    const stated = facts.flatMap((fact) => fact.text.match(/\d+(?:\.\d+)?/g) ?? []);
    expect(stated.filter((number) => !allowed.has(number))).toEqual([]);
  });
  test("the page file holds no typed number: its numbers come from the component", () => {
    const body = readPage("reference/autonomy-evidence").replace(/^---\n[\s\S]*?\n---/, "");
    expect(body.replace(/\]\([^)]*\)/g, "")).not.toMatch(/\d/);
  });
  test("each fact holds with every flag off: no flagged text, no Gemini", () => {
    const all = facts.map((fact) => fact.text).join("\n");
    expect(flaggedTextProblems(all)).toEqual([]);
    expect(geminiOutsideCondition([all])).toEqual([]);
  });
  test("the page lists existing capabilities and the shared category names match the code", () => {
    const listed = front(readPage("reference/autonomy-evidence")).capabilities;
    expect(listed).toEqual(expect.arrayContaining(["triage", "actions-and-undo"]));
    for (const name of listed) expect(() => readRepo(`docs/capabilities/${name}.md`)).not.toThrow();
    expect(GATE_BAR).toBe(0.98);
  });
});

describe("the two new pages stay held", () => {
  test("both are in OWNER_REVIEW_PENDING and have a page file", () => {
    for (const id of ["reference/api", "reference/autonomy-evidence"]) {
      expect(OWNER_REVIEW_PENDING).toContain(id);
      expect(() => readPage(id)).not.toThrow();
    }
  });
});
