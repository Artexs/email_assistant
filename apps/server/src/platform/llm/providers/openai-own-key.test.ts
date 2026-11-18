import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import OpenAI from "openai";
import { z } from "zod";

import { llmRoleTable, loadConfig } from "../../config";
import { createLlmClient } from "../client";

import { openAiClientOptions, openaiProvider } from "./openai";

const REAL_KEY = "sk-REAL-OPENAI-KEY-MARKER";
const schema = z.object({ category: z.string(), confidence: z.number() });
const call = { role: "classifier", promptVersion: "classifier-v2", schema, system: "S", prompt: "P" } as const;

const baseEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: REAL_KEY,
};

const savedEnv = { ...process.env };
beforeEach(() => {
  // What a shell of the operator may hold: the SDK reads each of them on its own.
  process.env.OPENAI_ORG_ID = "org-REAL-MARKER";
  process.env.OPENAI_PROJECT_ID = "proj-REAL-MARKER";
  process.env.OPENAI_API_KEY = REAL_KEY;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) Reflect.deleteProperty(process.env, key);
  Object.assign(process.env, savedEnv);
});

/** A local server that records the headers of each request and answers with a valid result. */
function fakeServer() {
  const seen: Record<string, string>[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      seen.push(Object.fromEntries(req.headers.entries()));
      return Response.json({
        status: "completed",
        output_text: '{"category":"a","confidence":1}',
        output: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
  return { seen, server, url: `http://127.0.0.1:${server.port}/v1` };
}

/** The full chain of production: env → config → role table → client → real SDK → server. */
async function callOwnServer(extraEnv: Record<string, string>) {
  const fake = fakeServer();
  try {
    const table = llmRoleTable(loadConfig({ ...baseEnv, OPENAI_BASE_URL: fake.url, ...extraEnv }));
    expect(table.providers.openai.endpoint).toBe("own");
    await createLlmClient({ table }).generate(call);
    expect(fake.seen).toHaveLength(1);
    return fake.seen[0] as Record<string, string>;
  } finally {
    await fake.server.stop(true);
  }
}

describe("an own endpoint never gets OpenAI credentials", () => {
  test("N1: the server sees the dummy key and no organization or project header", async () => {
    const headers = await callOwnServer({});
    expect(headers.authorization).toBe("Bearer own");
    expect(headers["openai-organization"]).toBeUndefined();
    expect(headers["openai-project"]).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain("REAL");
  });

  test("N1: OPENAI_OWN_API_KEY is the key of an own server", async () => {
    const headers = await callOwnServer({ OPENAI_OWN_API_KEY: "own-server-key" });
    expect(headers.authorization).toBe("Bearer own-server-key");
    expect(JSON.stringify(headers)).not.toContain("REAL");
  });

  test("N1: an own endpoint needs no OPENAI_API_KEY, also with the LLM scope on", async () => {
    const withoutKey = {
      ...baseEnv,
      OPENAI_API_KEY: undefined,
      OPENAI_BASE_URL: "http://127.0.0.1:11434/v1",
      TRIAGE_LLM_SCOPE: "synthetic",
    };
    const table = llmRoleTable(loadConfig(withoutKey));
    expect(table.providers.openai).toMatchObject({ apiKey: "own", endpoint: "own" });
    // The standard endpoint still needs its key.
    expect(() => loadConfig({ ...withoutKey, OPENAI_BASE_URL: "" })).toThrow();
  });

  test("N1: the OpenAI key stays on the standard and the EU row", () => {
    for (const url of ["", "https://eu.api.openai.com/v1"]) {
      const row = llmRoleTable(loadConfig({ ...baseEnv, OPENAI_BASE_URL: url, OPENAI_OWN_API_KEY: "own-server-key" }));
      expect(row.providers.openai.apiKey).toBe(REAL_KEY);
    }
  });

  test("N1: the adapter sends no organization and project for own; the options hold null", async () => {
    expect(openAiClientOptions("k", "http://127.0.0.1:1/v1", "own")).toMatchObject({
      organization: null,
      project: null,
    });
    expect("organization" in openAiClientOptions("k", "https://api.openai.com/v1", "standard")).toBe(false);
    // The adapter alone, with a key that is not OpenAI's: the env headers still stay home.
    const fake = fakeServer();
    try {
      await openaiProvider.createGenerate({
        apiKey: "k",
        reasoningEffort: null,
        baseUrl: fake.url,
        endpoint: "own",
      })({
        model: "m",
        system: "s",
        prompt: "p",
        jsonSchema: z.toJSONSchema(schema),
        signal: AbortSignal.timeout(5000),
      });
      expect(fake.seen[0]?.["openai-organization"]).toBeUndefined();
      expect(fake.seen[0]?.["openai-project"]).toBeUndefined();
    } finally {
      await fake.server.stop(true);
    }
  });
});

// The SDK reads more of the env than the key, the organization and the project.
describe("other env variables of the SDK stay home (own endpoint)", () => {
  test("OPENAI_ADMIN_KEY and OPENAI_WEBHOOK_SECRET never reach the client", () => {
    process.env.OPENAI_ADMIN_KEY = "sk-ADMIN-MARKER";
    process.env.OPENAI_WEBHOOK_SECRET = "whsec-MARKER";
    for (const endpoint of ["own", "standard", "eu"] as const) {
      const client = new OpenAI(openAiClientOptions("k", "https://api.openai.com/v1", endpoint));
      expect(client.adminAPIKey).toBeNull();
      expect(client.webhookSecret).toBeNull();
    }
  });

  test("the server sees no admin key (a request on the real SDK)", async () => {
    process.env.OPENAI_ADMIN_KEY = "sk-ADMIN-MARKER";
    const headers = await callOwnServer({});
    expect(JSON.stringify(headers)).not.toContain("ADMIN-MARKER");
  });

  // Checked on SDK 7.53.0: `defaultHeaders: {}` alone does not stop the env headers (the SDK merges them with the
  // option, an empty option included). A null value per header name does.
  test("OPENAI_CUSTOM_HEADERS: an empty defaultHeaders still lets the env header through (the SDK fact)", async () => {
    process.env.OPENAI_CUSTOM_HEADERS = "x-env-leak: LEAK-MARKER";
    const fake = fakeServer();
    try {
      const client = new OpenAI({ ...openAiClientOptions("k", fake.url, "own"), defaultHeaders: {} });
      await client.responses.create({ model: "m", input: "p" });
      expect(fake.seen[0]?.["x-env-leak"]).toBe("LEAK-MARKER");
    } finally {
      await fake.server.stop(true);
    }
  });

  test("OPENAI_CUSTOM_HEADERS: the adapter options null each env header; the server sees none", async () => {
    process.env.OPENAI_CUSTOM_HEADERS = "x-env-leak: LEAK-MARKER\nX-Second:two\nno colon line";
    expect(openAiClientOptions("k", "http://127.0.0.1:1/v1", "own").defaultHeaders).toEqual({
      "x-env-leak": null,
      "X-Second": null,
    });
    const headers = await callOwnServer({});
    expect(headers["x-env-leak"]).toBeUndefined();
    expect(headers["x-second"]).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain("LEAK-MARKER");
  });
});

describe("the OpenAI client log level", () => {
  test("N3: OPENAI_LOG=debug in the env does not change the client option", () => {
    process.env.OPENAI_LOG = "debug";
    const options = openAiClientOptions("k", "https://api.openai.com/v1");
    expect(options.logLevel).toBe("off");
    expect(new OpenAI(options).logLevel).toBe("off");
  });
});

describe("createGenerate with no base URL", () => {
  test("T3: a null baseUrl takes the default URL, never the OPENAI_BASE_URL of the env", async () => {
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/never";
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    // The SDK takes the global fetch when the client is built: patch before `createGenerate`.
    globalThis.fetch = Object.assign(
      async (input: Request | string | URL) => {
        urls.push(input instanceof Request ? input.url : String(input));
        throw new Error("no network in this test");
      },
      { preconnect: originalFetch.preconnect }
    );
    try {
      const generate = openaiProvider.createGenerate({
        apiKey: "k",
        reasoningEffort: null,
        baseUrl: null,
        endpoint: "standard",
      });
      await generate({
        model: "m",
        system: "s",
        prompt: "p",
        jsonSchema: z.toJSONSchema(schema),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(urls).toEqual(["https://api.openai.com/v1/responses"]);
  });
});
