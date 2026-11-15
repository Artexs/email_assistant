import { randomBytes } from "node:crypto";

import { describe, expect, spyOn, test } from "bun:test";

import { llmRoleTable, loadConfig } from "../config";
import { createLog } from "../log";

import { llmEndpointFields } from "./settings";

const env = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "SECRET-KEY-MARKER",
  OPENAI_MODEL_CLASSIFIER: "gpt-6-luna",
};

describe("llmEndpointFields (the llm_settings start log)", () => {
  test("1: an own server shows the kind and the hostname only: no path, no port", () => {
    const table = llmRoleTable(loadConfig({ ...env, OPENAI_BASE_URL: "http://127.0.0.1:11434/v1/secret-path" }));
    expect(llmEndpointFields(table, "classifier")).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
      endpoint: "own",
      host: "127.0.0.1",
    });
  });

  test("1: the default and the EU endpoint; an IPv6 host has no brackets; Gemini has no host", () => {
    expect(llmEndpointFields(llmRoleTable(loadConfig(env)), "classifier")).toMatchObject({
      endpoint: "standard",
      host: "api.openai.com",
    });
    expect(
      llmEndpointFields(llmRoleTable(loadConfig({ ...env, OPENAI_BASE_URL: "https://eu.api.openai.com/v1" })), "judge")
    ).toMatchObject({ endpoint: "eu", host: "eu.api.openai.com" });
    expect(
      llmEndpointFields(llmRoleTable(loadConfig({ ...env, OPENAI_BASE_URL: "http://[::1]:11434/v1" })), "classifier")
        .host
    ).toBe("::1");
    expect(
      llmEndpointFields(llmRoleTable(loadConfig({ ...env, LLM_PROVIDER: "gemini", GEMINI_API_KEY: "g" })), "classifier")
    ).toMatchObject({ provider: "gemini", endpoint: "standard", host: null });
  });

  test("1: the log line carries endpoint and host, and no URL, path or key", () => {
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    try {
      const table = llmRoleTable(loadConfig({ ...env, OPENAI_BASE_URL: "http://127.0.0.1:11434/v1/secret-path" }));
      createLog("main").info("llm_settings", llmEndpointFields(table, "classifier"));
    } finally {
      spy.mockRestore();
    }
    const text = lines.join("\n");
    expect(text).toContain("llm_settings");
    expect(text).toMatch(/endpoint["=:\s]+"?own/);
    expect(text).toContain("127.0.0.1");
    expect(text).not.toContain("11434");
    expect(text).not.toContain("secret-path");
    expect(text).not.toContain("://");
    expect(text).not.toContain("SECRET-KEY-MARKER");
  });
});
