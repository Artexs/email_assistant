import { apiErrorSchema } from "@ea/core/web";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: { path: string; code: string; message: string }[],
    // The parsed error body when it is a JSON object (the 409 gate of S5c reads it).
    readonly raw: Record<string, unknown> = {}
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export interface ApiDeps {
  // Not `typeof fetch`: the root @types/bun adds `fetch.preconnect`, which a fake or a wrapper lacks.
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  onUnauthorized: () => void;
}

interface ApiInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

async function readError(response: Response): Promise<ApiError> {
  let raw: Record<string, unknown> = {};
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) raw = body as Record<string, unknown>;
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { error, message, details } = parsed.data;
      return new ApiError(response.status, error, message, details, raw);
    }
  } catch {
    // A body that is not JSON falls through to the generic error.
  }
  return new ApiError(response.status, "internal", undefined, undefined, raw);
}

export function createApi(deps: ApiDeps) {
  return async function request<T>(path: string, schema: z.ZodType<T>, init: ApiInit = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const response = await deps.fetchImpl(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.status === 401) {
      deps.onUnauthorized();
      // The page is leaving: the promise never settles.
      return new Promise<T>(() => undefined);
    }
    if (!response.ok) throw await readError(response);
    if (response.status === 204) return undefined as T;
    return schema.parse(await response.json());
  };
}

export const api = createApi({
  fetchImpl: (input, init) => fetch(input, init),
  onUnauthorized: () => location.assign(`/login?next=${encodeURIComponent(location.pathname)}`),
});
