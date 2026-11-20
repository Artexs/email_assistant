import { describe, expect, test } from "bun:test";

import { checkSimEnv, LAB_FAKE_TELEGRAM_TOKEN, type SimEnvIssue } from "./env-guard";

const ALLOWED = ["wiktor.szalewski@kordelan.test", "anna@klient.test"];

const valid: Record<string, string | undefined> = {
  LAB_STACK: "ea-sim",
  MAIL_ALLOW_LOCAL_HOSTS: "true",
  TELEGRAM_API_ROOT: "http://127.0.0.1:8090",
  TELEGRAM_BOT_TOKEN: LAB_FAKE_TELEGRAM_TOKEN,
  SEND_SCOPE: "self",
  SEND_TEST_ADDRESSES: "wiktor.szalewski@kordelan.test,anna@klient.test",
  TRIAGE_LLM_SCOPE: "all",
  ACTIONS_SCOPE: "all",
  HEARTBEAT_URL: "",
};

const wrong: [SimEnvIssue, Record<string, string | undefined>][] = [
  ["not_sim_stack", { LAB_STACK: "ea-prod" }],
  ["local_hosts_off", { MAIL_ALLOW_LOCAL_HOSTS: "false" }],
  ["telegram_root_not_loopback", { TELEGRAM_API_ROOT: "https://api.telegram.org" }],
  ["telegram_token_not_fake", { TELEGRAM_BOT_TOKEN: "123456:real-looking-token-value-0000" }],
  ["send_scope_not_self", { SEND_SCOPE: "all" }],
  ["send_address_not_scenario", { SEND_TEST_ADDRESSES: "other@kordelan.test" }],
  ["triage_scope_not_all", { TRIAGE_LLM_SCOPE: "synthetic" }],
  ["actions_scope_not_all", { ACTIONS_SCOPE: "off" }],
  ["heartbeat_set", { HEARTBEAT_URL: "https://hc.example/ping" }],
  ["operator_chat_set", { OPERATOR_TELEGRAM_CHAT_ID: "-1001" }],
  ["operator_users_set", { OPERATOR_USER_IDS: "0f9c1a52-6b1e-4c53-9a53-3d1a4e5f6a7b" }],
  ["auth_mail_set", { AUTH_SMTP_HOST: "greenmail" }],
];

describe("checkSimEnv", () => {
  test("6 a valid env gives no issue", () => {
    expect(checkSimEnv(valid, ALLOWED)).toEqual([]);
  });

  test.each(wrong)("7 only %p is wrong gives exactly that code", (issue, change) => {
    expect(checkSimEnv({ ...valid, ...change }, ALLOWED)).toEqual([issue]);
  });

  test("7 each of the 12 codes has a case", () => {
    expect(new Set(wrong.map(([issue]) => issue)).size).toBe(12);
  });

  test("7 an unset TELEGRAM_API_ROOT (the real Telegram) is telegram_root_not_loopback", () => {
    expect(checkSimEnv({ ...valid, TELEGRAM_API_ROOT: undefined }, ALLOWED)).toEqual(["telegram_root_not_loopback"]);
    expect(checkSimEnv({ ...valid, TELEGRAM_API_ROOT: "" }, ALLOWED)).toEqual(["telegram_root_not_loopback"]);
  });

  test("7 any AUTH_SMTP_ key that is set is auth_mail_set; an empty one is not", () => {
    expect(checkSimEnv({ ...valid, AUTH_SMTP_USER: "u" }, ALLOWED)).toEqual(["auth_mail_set"]);
    expect(checkSimEnv({ ...valid, AUTH_SMTP_PORT: "465" }, ALLOWED)).toEqual(["auth_mail_set"]);
    expect(checkSimEnv({ ...valid, AUTH_SMTP_HOST: "", AUTH_SMTP_USER: " " }, ALLOWED)).toEqual([]);
  });

  test("9 a send address that is not a scenario address, or not on a .test domain, is refused", () => {
    expect(checkSimEnv({ ...valid, SEND_TEST_ADDRESSES: "a@kordelan.test,b@gmail.com" }, ALLOWED)).toEqual([
      "send_address_not_scenario",
    ]);
    expect(checkSimEnv({ ...valid, SEND_TEST_ADDRESSES: "b@gmail.com" }, ["b@gmail.com"])).toEqual([
      "send_address_not_scenario",
    ]);
    expect(checkSimEnv({ ...valid, SEND_TEST_ADDRESSES: " Anna@Klient.test " }, ALLOWED)).toEqual([]);
  });

  test.each<[string, string | undefined, string[], SimEnvIssue[]]>([
    [
      "two addresses when one is allowed",
      "lab@example.test, other@example.test",
      ["lab@example.test"],
      ["send_address_not_scenario"],
    ],
    [
      "two allowed addresses with spaces and a trailing comma",
      "lab@example.test , other@example.test,",
      ["lab@example.test", "other@example.test"],
      [],
    ],
    ["an allowed list with spaces and capitals", "lab@example.test", ["  LAB@Example.test "], []],
    ["an empty list", "", ["lab@example.test"], []],
    ["a list of blanks and commas", " , ,", ["lab@example.test"], []],
    ["an unset list", undefined, ["lab@example.test"], []],
  ])("the send addresses: %s", (_name, raw, allowed, issues) => {
    expect(checkSimEnv({ ...valid, SEND_TEST_ADDRESSES: raw }, allowed)).toEqual(issues);
  });

  test("several wrong keys come in the fixed order, and no issue holds a value", () => {
    const secret = "9999:very-secret-token-value-123456";
    const issues = checkSimEnv(
      { ...valid, ACTIONS_SCOPE: "off", LAB_STACK: "x", TELEGRAM_BOT_TOKEN: secret, HEARTBEAT_URL: "https://h.test/k" },
      ALLOWED
    );
    expect(issues).toEqual(["not_sim_stack", "telegram_token_not_fake", "actions_scope_not_all", "heartbeat_set"]);
    expect(JSON.stringify(issues)).not.toContain(secret);
  });
});
