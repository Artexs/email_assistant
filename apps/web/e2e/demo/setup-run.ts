import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { type Me, type MailboxView, type SettingsWebView } from "@ea/core/web";

import { createLabMailClient } from "../../../server/src/modules/lab/mail-client";
import { createFakeTelegramClient } from "../../../../tools/fake-telegram/src/driver";
import { E2E_BASE_URL, E2E_TELEGRAM_URL, e2eEnv, GREENMAIL, repoRoot } from "../env";
import { DEMO_OWNER_FILE } from "../docs-shots/shots-dir";
import type { DemoRunPlan } from "../lib/demo/run-plan";
import {
  DEMO_CHAT_ID,
  DEMO_FLAGS_OFF,
  DEMO_FLAGS_ON,
  demoMessage,
  parseFlagList,
  purgeMailboxB,
  type SetupState,
  shiftedDates,
} from "../lib/demo/setup";

// The setup of the demo organization before the recording, through product paths only: the panel API as the owner, the product CLIs, the
// fake Telegram and IMAP on the dev GreenMail. No SQL. `runDemoSetup` runs after the import and the flags; `collectSetupState` is the
// read of the state check of the `@setup` test.

// A client address for each sign-in (the login rate limit counts per address): documentation range 192.0.2.0/24. The recording
// signs in from 192.0.2.231 to 192.0.2.239.
export const SETUP_ADDRESS = "192.0.2.220";
export const CHECK_ADDRESS = "192.0.2.221";
// GreenMail of the dev stack runs with authentication off: any password logs in.
const MAILBOX_B_PASSWORD = "demo-mailbox-password";
const LINK_WAIT_MS = 15_000;
const POLL_MS = 250;

/** The panel API as one signed-in user: the session cookies of the sign-in, and the Origin header that the CSRF check reads. */
export interface OwnerApi {
  get<T>(path: string): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

export interface DemoOwner {
  orgId: string;
  email: string;
  password: string;
}

export function readDemoOwner(file: string = DEMO_OWNER_FILE): DemoOwner {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    orgId: string;
    owner: { email: string; password: string };
  };
  return { orgId: parsed.orgId, ...parsed.owner };
}

export async function signInOwner(owner: DemoOwner, clientAddress: string): Promise<OwnerApi> {
  const headers = { origin: E2E_BASE_URL, "x-forwarded-for": clientAddress };
  const response = await fetch(`${E2E_BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ email: owner.email, password: owner.password }),
  });
  if (!response.ok) throw new Error(`demo_owner_sign_in ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .join("; ");
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const reply = await fetch(`${E2E_BASE_URL}/api${path}`, {
      method,
      headers: { ...headers, cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!reply.ok) throw new Error(`demo_api ${method} ${path} ${reply.status}`);
    return (await reply.json()) as T;
  };
  return { get: (path) => call("GET", path), patch: (path, body) => call("PATCH", path, body) };
}

const mailClientOf = (mailboxB: string) =>
  createLabMailClient({
    host: GREENMAIL.host,
    imapPort: GREENMAIL.imapPort,
    smtpPort: GREENMAIL.smtpPort,
    password: MAILBOX_B_PASSWORD,
    allowedAddresses: new Set([mailboxB]),
  });

/** APPENDs the mails into the INBOX of B with their internal dates, in the order given. */
export async function deliverToB(
  mailboxB: string,
  messages: readonly { raw: string; internalDate: Date }[]
): Promise<void> {
  const client = mailClientOf(mailboxB);
  for (const message of messages) await client.appendInbox(mailboxB, message.raw, message.internalDate);
}

// Runs a product CLI with the plain e2e env (model scope off). Returns stdout and stderr, which the caller never prints: the link
// command writes a one-time token. A failed command is `demo_cli_failed <script>`.
function runCli(script: string, args: string[]): string {
  const done = spawnSync("bun", [`apps/server/src/scripts/${script}`, ...args], {
    cwd: repoRoot,
    env: e2eEnv(),
    encoding: "utf8",
  });
  if (done.status !== 0) throw new Error(`demo_cli_failed ${script}`);
  return `${done.stdout}\n${done.stderr}`;
}

/** The state of the flags of the organization, from `org:flag --org-id <uuid>`. */
export function readFlags(orgId: string): Record<string, boolean> {
  return parseFlagList(runCli("org-flag.ts", ["--org-id", orgId]));
}

async function linkOwnerToTelegram(api: OwnerApi, orgId: string): Promise<void> {
  const me = await api.get<Me>("/me");
  // The link token is a one-time secret of the test run: it goes from the CLI to the fake chat and is never printed.
  const output = runCli("telegram-link.ts", ["--org-id", orgId, "--user-id", me.user.id]);
  const token = /[?&]start=([A-Za-z0-9_-]+)/.exec(output)?.[1];
  if (token === undefined) throw new Error("demo_telegram_link_failed token");
  await createFakeTelegramClient(E2E_TELEGRAM_URL).send(`/start ${token}`, { chatId: DEMO_CHAT_ID });
  const deadline = Date.now() + LINK_WAIT_MS;
  while (!(await api.get<Me>("/me")).telegram.linked) {
    if (Date.now() > deadline) throw new Error("demo_telegram_link_failed wait");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

// `auto` off for each category of mailbox A that has it, else the re-gate sends `autonomy_paused` into the chat of the owner.
async function turnAutoOff(api: OwnerApi, mailboxId: string): Promise<void> {
  const settings = await api.get<SettingsWebView>(`/settings/${mailboxId}`);
  for (const entry of settings.categories.filter((category) => category.auto)) {
    await api.patch(`/settings/${mailboxId}/auto/${entry.category}`, { auto: false });
  }
}

/**
 * Makes the demo organization ready for the recording, in order: the flags (the steps, quiet hours, the two off flags), `auto` off on mailbox A, the
 * link to the fake chat, no quiet hours, an empty mailbox B, the history set in the INBOX of B. Logs `demo_setup_done history=<n>`.
 */
export async function runDemoSetup(plan: DemoRunPlan, owner: DemoOwner, now: Date = new Date()): Promise<void> {
  // The off flags too: an import may carry a flag that makes extractor or drafter calls, and the replay answers none of them.
  for (const flag of DEMO_FLAGS_ON) runCli("org-flag.ts", ["--org-id", owner.orgId, "--flag", flag, "--on"]);
  for (const flag of DEMO_FLAGS_OFF) runCli("org-flag.ts", ["--org-id", owner.orgId, "--flag", flag, "--off"]);
  const api = await signInOwner(owner, SETUP_ADDRESS);
  const [mailboxA] = await api.get<MailboxView[]>("/mailboxes");
  if (mailboxA === undefined) throw new Error("demo_setup_no_mailbox");
  await turnAutoOff(api, mailboxA.id);
  await linkOwnerToTelegram(api, owner.orgId);
  await api.patch("/me/notify", { quietStart: "00:00", quietEnd: "00:00" });

  await purgeMailboxB(mailClientOf(plan.mailboxB), plan.mailboxB);
  const dates = shiftedDates(
    plan.history.map((mail) => mail.at),
    now
  );
  const runTag = randomBytes(2).toString("hex");
  // Oldest first: the UIDs then follow the dates.
  const messages = plan.history
    .map((mail, at) => ({ mail, date: dates[at] ?? now }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(({ mail, date }, at) => ({
      raw: demoMessage(mail, { to: plan.mailboxB, seq: at + 1, runTag, date }),
      internalDate: date,
    }));
  await deliverToB(plan.mailboxB, messages);
  // eslint-disable-next-line no-console
  console.log(`demo_setup_done history=${messages.length}`);
}

/** Reads the state that `setupProblems` checks, as the owner sees it. */
export async function collectSetupState(plan: DemoRunPlan, owner: DemoOwner): Promise<SetupState> {
  const api = await signInOwner(owner, CHECK_ADDRESS);
  const mailboxes = await api.get<MailboxView[]>("/mailboxes");
  const mailboxA = mailboxes.find((mailbox) => mailbox.address.toLowerCase() !== plan.mailboxB.toLowerCase());
  const settings = mailboxA === undefined ? undefined : await api.get<SettingsWebView>(`/settings/${mailboxA.id}`);
  const me = await api.get<Me>("/me");
  const notify = await api.get<{ quietStart: string | null; quietEnd: string | null }>("/me/notify");
  const chat = await createFakeTelegramClient(E2E_TELEGRAM_URL).read({ chatId: DEMO_CHAT_ID });
  return {
    mailboxA: mailboxA === undefined ? null : { status: mailboxA.status },
    mailboxAddresses: mailboxes.map((mailbox) => mailbox.address),
    mailboxB: plan.mailboxB,
    autoCategories: (settings?.categories ?? []).filter((entry) => entry.auto).map((entry) => entry.category),
    botTexts: chat.filter((message) => message.from === "bot").map((message) => message.text),
    flags: readFlags(owner.orgId),
    telegramLinked: me.telegram.linked,
    quiet: { start: notify.quietStart, end: notify.quietEnd },
    inboxB: await mailClientOf(plan.mailboxB).countInbox(plan.mailboxB),
    historyCount: plan.history.length,
  };
}
