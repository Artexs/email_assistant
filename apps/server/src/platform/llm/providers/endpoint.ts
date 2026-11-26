import type { LlmEndpointKind } from "@ea/core";

import { DEEPSEEK_HOST } from "./deepseek-host";

/** The default endpoint of the `openai` provider. */
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** A parsed and accepted endpoint. `url` has no trailing `/`; `host` is the lower-case hostname only (no port, no brackets). */
export interface LlmEndpoint {
  url: string;
  host: string;
  endpoint: LlmEndpointKind;
}

const STANDARD_HOST = "api.openai.com";
const EU_HOST = "eu.api.openai.com";

/** The OpenAI domain and its sub-domains: no other host may claim to be OpenAI. */
export const isOpenAiHost = (host: string): boolean => host === "openai.com" || host.endsWith(".openai.com");

/** `127.0.0.0/8`, `::1` and `localhost`. The IPv4-mapped IPv6 form is not accepted. */
function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host === "[::1]") return true;
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part)) && parts[0] === "127";
}

/** A host name with one label: a container on the same machine, for example `ollama`. */
const isOneLabelHost = (host: string): boolean => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(host);

/**
 * The check of `OPENAI_BASE_URL`. An error text never holds the raw value (it may hold a password or a token).
 * `ownKind` is true when `OPENAI_ENDPOINT_KIND=own` ("a server I run").
 */
export function parseLlmBaseUrl(raw: string, ownKind = false): LlmEndpoint | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: "not a valid URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "must start with https:// or http://" };
  }
  if (parsed.username !== "" || parsed.password !== "") return { error: "must not hold a user name or password" };
  if (parsed.search !== "" || parsed.hash !== "") return { error: "must not hold a query or a fragment" };
  // `URL` lower-cases the host; one trailing dot (the absolute form) goes.
  const host = parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname;
  if (host === "") return { error: "has no host" };
  const plainHost = host.replace(/^\[|\]$/g, "");
  const port = parsed.port === "" ? "" : `:${parsed.port}`;
  const url = `${parsed.protocol}//${host}${port}${parsed.pathname}`.replace(/\/+$/, "");
  const isHttps = parsed.protocol === "https:";
  const local = isLoopbackHost(host) || isOneLabelHost(host);

  // The DeepSeek row owns its host, its key and its price rows. No endpoint kind may reach that host through this key: the OpenAI
  // identity headers and the OpenAI price rows must not meet the DeepSeek host. The text names the key and holds no value.
  if (host === DEEPSEEK_HOST || host.endsWith(`.${DEEPSEEK_HOST}`)) {
    return {
      error: "OPENAI_BASE_URL must not point at the DeepSeek host; use LLM_PROVIDER=deepseek with DEEPSEEK_API_KEY",
    };
  }
  if (isOpenAiHost(host)) {
    if (ownKind) return { error: "OPENAI_ENDPOINT_KIND=own cannot relabel an OpenAI host" };
    if (!isHttps) return { error: "an OpenAI host needs https" };
    if (host === STANDARD_HOST) return { url, host: plainHost, endpoint: "standard" };
    if (host === EU_HOST) return { url, host: plainHost, endpoint: "eu" };
    return { error: "this OpenAI host has no price rows; use api.openai.com or eu.api.openai.com" };
  }
  if (!isHttps && !local) {
    return { error: "http is allowed only to a loopback address or a one-label host; use https" };
  }
  if (!local && !ownKind) {
    return {
      error: "hosted OpenAI-compatible API not supported; set OPENAI_ENDPOINT_KIND=own only for a server you run",
    };
  }
  return { url, host: plainHost, endpoint: "own" };
}
