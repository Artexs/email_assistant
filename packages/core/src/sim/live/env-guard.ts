import { isLoopbackApiRoot } from "../../loopback";

// The check that keeps the lab off any stack that is not the sim stack. It returns codes, never a value of a key.
export type SimEnvIssue =
  | "not_sim_stack"
  | "local_hosts_off"
  | "telegram_root_not_loopback"
  | "telegram_token_not_fake"
  | "send_scope_not_self"
  | "send_address_not_scenario"
  | "triage_scope_not_all"
  | "actions_scope_not_all"
  | "heartbeat_set"
  | "operator_chat_set"
  | "operator_users_set"
  | "auth_mail_set";

export const SIM_STACK_NAME = "ea-sim";

// The default token of tools/fake-telegram (FAKE_TOKEN). A server test keeps the two equal.
export const LAB_FAKE_TELEGRAM_TOKEN = "1000001:fake-telegram-token-local-tests-only";

type Env = Record<string, string | undefined>;

const AUTH_SMTP_PREFIX = "AUTH_SMTP_";

function isSet(env: Env, key: string): boolean {
  return (env[key] ?? "").trim() !== "";
}

function sendAddressesAllowed(raw: string | undefined, allowedAddresses: readonly string[]): boolean {
  const allowed = new Set(allowedAddresses.map((address) => address.trim().toLowerCase()));
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "")
    .every((entry) => allowed.has(entry) && entry.endsWith(".test"));
}

/** The issues of `env`, in a fixed order; `[]` means the env is the sim stack. */
export function checkSimEnv(env: Env, allowedAddresses: readonly string[]): SimEnvIssue[] {
  const issues: SimEnvIssue[] = [];
  const check = (issue: SimEnvIssue, fails: boolean) => {
    if (fails) issues.push(issue);
  };
  const telegramRoot = env.TELEGRAM_API_ROOT ?? "";
  check("not_sim_stack", env.LAB_STACK !== SIM_STACK_NAME);
  check("local_hosts_off", env.MAIL_ALLOW_LOCAL_HOSTS !== "true");
  check("telegram_root_not_loopback", telegramRoot === "" || !isLoopbackApiRoot(telegramRoot));
  check("telegram_token_not_fake", env.TELEGRAM_BOT_TOKEN !== LAB_FAKE_TELEGRAM_TOKEN);
  check("send_scope_not_self", env.SEND_SCOPE !== "self");
  check("send_address_not_scenario", !sendAddressesAllowed(env.SEND_TEST_ADDRESSES, allowedAddresses));
  check("triage_scope_not_all", env.TRIAGE_LLM_SCOPE !== "all");
  check("actions_scope_not_all", env.ACTIONS_SCOPE !== "all");
  check("heartbeat_set", isSet(env, "HEARTBEAT_URL"));
  check("operator_chat_set", isSet(env, "OPERATOR_TELEGRAM_CHAT_ID"));
  check("operator_users_set", isSet(env, "OPERATOR_USER_IDS"));
  check(
    "auth_mail_set",
    Object.keys(env).some((key) => key.startsWith(AUTH_SMTP_PREFIX) && isSet(env, key))
  );
  return issues;
}
