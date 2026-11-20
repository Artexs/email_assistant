// The data of the API reference page (`reference/api`): the committed OpenAPI file (`docs/api/openapi.json`, written by
// `bun run api:spec`) in the shape that the page renders. The page holds no route text of its own.
// Imported as JSON, not read from a path: the build bundles the component, so a path from the source file would point into the bundle.
import openapi from "../../../docs/api/openapi.json";

export const API_SPEC_FILE = "docs/api/openapi.json";

interface SpecResponse {
  description?: string;
  content?: Record<string, { schema?: unknown } | undefined>;
}

interface SpecOperation {
  operationId: string;
  summary?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean; schema?: { type?: string; format?: string } }[];
  requestBody?: SpecResponse;
  responses: Record<string, SpecResponse | undefined>;
}

export interface ApiSpec {
  paths: Record<string, Record<string, SpecOperation> | undefined>;
}

export interface ApiAnswer {
  status: string;
  /** `OK`, `No content`, or `Error codes: a, b` as the file says it. */
  description: string;
  /** The schema label: `error` for the shared error answer, else the shape (`object (id, name)`); null for no body. */
  schemaName: string | null;
  /** The JSON schema, shown for a success answer and for an error answer that is not the shared one; else null. */
  schema: unknown;
}

export interface ApiOperation {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  tag: string;
  auth: "session" | "public";
  parameters: string[];
  request: { schemaName: string; schema: unknown } | null;
  answers: ApiAnswer[];
}

export interface ApiGroup {
  tag: string;
  operations: ApiOperation[];
}

export function loadApiSpec(): ApiSpec {
  return openapi as unknown as ApiSpec;
}

const MAX_NAMED_KEYS = 6;

/** A short label for a JSON schema: its shape, with the field names of an object. */
export function schemaLabel(schema: unknown): string {
  const node = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    items?: unknown;
    enum?: unknown[];
  } | null;
  if (node === null || typeof node !== "object") return "value";
  if (node.type === "object" && node.properties !== undefined) {
    const keys = Object.keys(node.properties);
    const shown = keys.slice(0, MAX_NAMED_KEYS).join(", ");
    return `object (${shown}${keys.length > MAX_NAMED_KEYS ? ", …" : ""})`;
  }
  if (node.type === "array") return `array of ${schemaLabel(node.items)}`;
  return node.type ?? "value";
}

const ERROR_NAME = "error";
const jsonSchema = (response: SpecResponse | undefined): unknown => response?.content?.["application/json"]?.schema;

// The error answer that every route shares: the one that most 4xx answers carry. A 4xx answer with another schema (a 409 with its
// own fields) is shown in full.
function sharedErrorSchema(spec: ApiSpec): string | null {
  const counts = new Map<string, number>();
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item ?? {})) {
      for (const [status, response] of Object.entries(operation.responses)) {
        const schema = jsonSchema(response);
        if (status.startsWith("2") || schema === undefined) continue;
        const key = JSON.stringify(schema);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Every operation of the file, in the order of the file. */
export function apiOperations(spec: ApiSpec): ApiOperation[] {
  const shared = sharedErrorSchema(spec);
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      const answers = Object.entries(operation.responses).map(([status, response]): ApiAnswer => {
        const schema = jsonSchema(response);
        const isShared = schema !== undefined && JSON.stringify(schema) === shared;
        return {
          status,
          description: response?.description ?? "",
          schemaName: schema === undefined ? null : isShared ? ERROR_NAME : schemaLabel(schema),
          schema: schema === undefined || isShared ? null : schema,
        };
      });
      const body = jsonSchema(operation.requestBody);
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? "",
        tag: operation.tags?.[0] ?? "other",
        auth: Array.isArray(operation.security) && operation.security.length === 0 ? "public" : "session",
        parameters: (operation.parameters ?? []).map(
          (p) => `${p.name} (${p.in}${p.required ? ", required" : ""}${p.schema?.format ? `, ${p.schema.format}` : ""})`
        ),
        request: body === undefined ? null : { schemaName: schemaLabel(body), schema: body },
        answers,
      });
    }
  }
  return operations;
}

/** Groups by tag (sorted), each sorted by path, then method. */
export function apiGroups(operations: readonly ApiOperation[]): ApiGroup[] {
  const tags = [...new Set(operations.map((operation) => operation.tag))].sort();
  return tags.map((tag) => ({
    tag,
    operations: operations
      .filter((operation) => operation.tag === tag)
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
  }));
}

/** The answers that are a success (2xx). */
export const successAnswers = (operation: ApiOperation): ApiAnswer[] =>
  operation.answers.filter((answer) => answer.status.startsWith("2"));
