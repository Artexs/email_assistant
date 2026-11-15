import { apiErrorSchema } from "@ea/core";
import type { Env, Hono, MiddlewareHandler, Schema } from "hono";
import { describeRoute, generateSpecs, resolver, type DescribeRouteOptions, type OpenAPIDocument } from "hono-openapi";
import { z, type ZodType } from "zod";

// The OpenAPI file of the panel API (ADR 0023). Routes keep `parseBody`: the `validator` of `hono-openapi` is never
// used, because it answers a 400 with another shape than `ValidationError`. A route describes itself through `apiDoc`.

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503;

export interface ApiDocSpec {
  operationId: string; // unique in the file
  summary: string;
  tags: string[];
  body?: ZodType; // the JSON body the route parses with `parseBody`
  query?: ZodType; // an object schema: each key is one query parameter
  ok: { status: 200 | 201; schema: ZodType };
  errors?: { status: ApiErrorStatus; codes: string[] }[]; // every body is `{ error, … }` (`apiErrorSchema`)
  public?: true; // the route needs no session: `security: []`
  hide?: { reason: string }; // the route is left out of the file; the reason is for the reader of the code
}

export const OPENAPI_PATH = "/api/openapi.json";
export const SESSION_SCHEME = "session";

const DOCUMENT: NonNullable<Parameters<typeof generateSpecs>[1]>["documentation"] = {
  openapi: "3.1.0",
  // ADR 0023: no API version before E12.
  info: { title: "Email assistant API", version: "0", description: "The API of the web panel." },
  security: [{ [SESSION_SCHEME]: [] }],
  components: {
    securitySchemes: {
      [SESSION_SCHEME]: {
        type: "apiKey",
        in: "cookie",
        name: "ea.session_token",
        description: "The session cookie that the sign-in sets.",
      },
    },
  },
};

// Operator routes (E10: the docs site publishes the file) and Better Auth routes never enter the file, also when a
// route carries an `apiDoc` by mistake.
const EXCLUDED_PATHS: RegExp[] = [/^\/api\/operator(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/openapi\.json$/];

type Parameter = Exclude<NonNullable<DescribeRouteOptions["parameters"]>[number], { $ref: string }>;

function queryParameters(schema: ZodType): Parameter[] {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, Parameter["schema"]>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: "query",
    required: json.required?.includes(name) ?? false,
    schema: property,
  }));
}

export function apiDoc(spec: ApiDocSpec): MiddlewareHandler {
  const json = (schema: ZodType) => ({ "application/json": { schema: resolver(schema) } });
  const responses: NonNullable<DescribeRouteOptions["responses"]> = {
    [spec.ok.status]: { description: "OK", content: json(spec.ok.schema) },
  };
  for (const error of spec.errors ?? []) {
    responses[error.status] = {
      description: `Error codes: ${error.codes.join(", ")}`,
      content: json(apiErrorSchema),
    };
  }
  return describeRoute({
    operationId: spec.operationId,
    summary: spec.summary,
    tags: spec.tags,
    responses,
    ...(spec.body ? { requestBody: { required: true, content: json(spec.body) } } : {}),
    ...(spec.query ? { parameters: queryParameters(spec.query) } : {}),
    ...(spec.public ? { security: [] } : {}),
    ...(spec.hide ? { hide: true } : {}),
  });
}

// `root` is the whole `createApp` app, so a route before the session guard is in the file too.
export async function openApiSpec<E extends Env, S extends Schema, P extends string>(
  root: Hono<E, S, P>
): Promise<OpenAPIDocument> {
  return generateSpecs(root, { documentation: DOCUMENT, exclude: EXCLUDED_PATHS });
}
