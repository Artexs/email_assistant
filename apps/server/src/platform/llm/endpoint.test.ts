import { describe, expect, test } from "bun:test";

import { parseLlmBaseUrl } from "./endpoint";

const ok = (raw: string, ownKind = false) => {
  const result = parseLlmBaseUrl(raw, ownKind);
  if ("error" in result) throw new Error(`expected an endpoint, got: ${result.error}`);
  return result;
};
const bad = (raw: string, ownKind = false) => {
  const result = parseLlmBaseUrl(raw, ownKind);
  if (!("error" in result)) throw new Error(`expected an error for ${result.endpoint} ${result.host}`);
  return result.error;
};

describe("parseLlmBaseUrl", () => {
  test("1: the default URL is standard; the trailing slash goes", () => {
    expect(ok("https://api.openai.com/v1/")).toEqual({
      url: "https://api.openai.com/v1",
      host: "api.openai.com",
      endpoint: "standard",
    });
  });

  test("2: the EU host is eu, also in upper case and with a trailing dot", () => {
    expect(ok("https://eu.api.openai.com/v1").endpoint).toBe("eu");
    expect(ok("https://EU.api.openai.com./v1")).toEqual({
      url: "https://eu.api.openai.com/v1",
      host: "eu.api.openai.com",
      endpoint: "eu",
    });
  });

  test("3: another region host of OpenAI has no price rows", () => {
    expect(bad("https://us.api.openai.com/v1")).toContain("no price rows");
    expect(bad("https://jp.api.openai.com/v1")).toContain("no price rows");
  });

  test("4: http to loopback or a one-label host is own", () => {
    for (const [raw, host] of [
      ["http://127.0.0.1:11434/v1", "127.0.0.1"],
      ["http://127.1.2.3:11434/v1", "127.1.2.3"],
      ["http://localhost:11434/v1", "localhost"],
      ["http://[::1]:11434/v1", "::1"],
      ["http://ollama:11434/v1", "ollama"],
    ] as const) {
      const parsed = ok(raw);
      expect(parsed.endpoint).toBe("own");
      expect(parsed.host).toBe(host);
      expect(parsed.url).toBe(raw);
    }
  });

  test("5: http to another host is refused", () => {
    for (const raw of ["http://[::ffff:127.0.0.1]/v1", "http://192.168.1.10:11434/v1", "http://llm.example.com/v1"]) {
      expect(bad(raw)).toContain("http");
      expect(bad(raw, true)).toContain("http");
    }
    expect(bad("http://api.openai.com/v1")).toContain("needs https");
  });

  test("6: a remote https host is refused, and own only with the kind", () => {
    expect(bad("https://llm.example.com/v1")).toBe(
      "hosted OpenAI-compatible API not supported; set OPENAI_ENDPOINT_KIND=own only for a server you run"
    );
    expect(ok("https://llm.example.com/v1", true)).toEqual({
      url: "https://llm.example.com/v1",
      host: "llm.example.com",
      endpoint: "own",
    });
  });

  test("7: Azure and OpenRouter are refused without the kind", () => {
    expect(bad("https://res.openai.azure.com/openai/v1")).toContain("hosted OpenAI-compatible API not supported");
    expect(bad("https://openrouter.ai/api/v1")).toContain("hosted OpenAI-compatible API not supported");
  });

  test("8: the kind cannot relabel an OpenAI host", () => {
    expect(bad("https://eu.api.openai.com/v1", true)).toContain("cannot relabel");
    expect(bad("https://api.openai.com/v1", true)).toContain("cannot relabel");
    expect(bad("https://openai.com/v1", true)).toContain("cannot relabel");
  });

  test("9: user info, query, fragment and a non-URL are refused without the value in the text", () => {
    const texts = [
      bad("https://user:pw@llm.example.com/v1", true),
      bad("https://user@llm.example.com/v1", true),
      bad("https://llm.example.com/v1?token=abc", true),
      bad("https://llm.example.com/v1#x", true),
      bad("not a url secret-value"),
      bad("ftp://llm.example.com/v1", true),
    ];
    for (const text of texts) {
      expect(text).not.toContain("pw");
      expect(text).not.toContain("abc");
      expect(text).not.toContain("secret-value");
      expect(text).not.toContain("example");
    }
    expect(texts[4]).toBe("not a valid URL");
  });

  // The URL parser of the runtime reads these forms; the class of each is pinned here, so that a later change of the
  // host rules cannot move one silently.
  test("T1: numeric and IPv6 loopback forms are own, with the normalized host", () => {
    for (const [raw, host] of [
      ["http://127.1:11434/v1", "127.0.0.1"],
      ["http://0x7f.1/v1", "127.0.0.1"],
      ["http://2130706433/v1", "127.0.0.1"],
      ["http://0177.0.0.1/v1", "127.0.0.1"],
      ["http://[0:0:0:0:0:0:0:1]/v1", "::1"],
      ["http://localhost./v1", "localhost"],
      ["http://ollama./v1", "ollama"],
    ] as const) {
      expect(ok(raw)).toMatchObject({ endpoint: "own", host });
    }
  });

  test("T1: other IPv6, wildcard and link-local addresses over http are refused", () => {
    for (const raw of ["http://[fe80::1]/v1", "http://[::]/v1", "http://0.0.0.0/v1", "http://169.254.169.254/latest"]) {
      expect(bad(raw)).toContain("http is allowed only");
      expect(bad(raw, true)).toContain("http is allowed only");
    }
  });

  test("T1: look-alike hosts of OpenAI are not OpenAI hosts", () => {
    expect(bad("https://api.openai.com.evil.test/v1")).toContain("hosted OpenAI-compatible API not supported");
    expect(bad("https://api-openai.com/v1")).toContain("hosted OpenAI-compatible API not supported");
    // An internationalized sub-domain of openai.com is an OpenAI host with no price rows.
    expect(bad("https://xn--pi-7kc.openai.com/v1")).toContain("no price rows");
    expect(bad("https://xn--pi-7kc.openai.com/v1", true)).toContain("cannot relabel");
    // With the kind, the operator says "a server I run": a look-alike host is own, never standard.
    expect(ok("https://api.openai.com.evil.test/v1", true).endpoint).toBe("own");
  });
});
