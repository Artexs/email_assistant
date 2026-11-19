import { apiErrorSchema } from "@ea/core";
import type { Env, Hono, MiddlewareHandler, Schema } from "hono";
import { describeRoute, generateSpecs, resolver, type DescribeRouteOptions, type OpenAPIDocument } from "hono-openapi";
import { z, type ZodType } from "zod";

// The OpenAPI file of the panel API (ADR 0023). Routes keep `parseBody`: the `validator` of `hono-openapi` is never
// used, because it answers a 400 with another shape than `ValidationError`. A route describes itself through `apiDoc`.

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 502 | 503;

export interface ApiDocSpec {
  operationId: string; // unique in the file
  summary: string;
  tags: string[];
  body?: ZodType; // the JSON body the route parses with `parseBody`
  params?: ZodType; // an object schema: each key is one path parameter
  query?: ZodType; // an object schema: each key is one query parameter
  ok: { status: 200 | 201 | 202; schema: ZodType } | { status: 204 }; // 204: an empty answer, no body
  alsoOk?: { status: 200 | 201 | 202; schema: ZodType }; // a second success answer of the same route (a 200 beside the 202)
  // Every body is `{ error, … }` (`apiErrorSchema`); `schema` is a stricter shape of it, for a body with more fields.
  errors?: readonly { status: ApiErrorStatus; codes: readonly string[]; schema?: ZodType }[];
  public?: true; // the route needs no session: `security: []`
  hide?: { reason: string }; // the route is left out of the file; the reason is for the reader of the code
}

export const OPENAPI_PATH = "/api/openapi.json";
export const SESSION_SCHEME = "session";

const DOCUMENT: NonNullable<Parameters<typeof generateSpecs>[1]>["documentation"] = {
  openapi: "3.1.0",
  // ADR 0023: no API version before a second client ships.
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

// Operator routes (the docs site publishes the file) and Better Auth routes never enter the file, also when a
// route carries an `apiDoc` by mistake.
const EXCLUDED_PATHS: RegExp[] = [/^\/api\/operator(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/openapi\.json$/];

type Parameter = Exclude<NonNullable<DescribeRouteOptions["parameters"]>[number], { $ref: string }>;

function parameters(schema: ZodType, place: "query" | "path"): Parameter[] {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, Parameter["schema"]>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: place,
    required: place === "path" || (json.required?.includes(name) ?? false),
    schema: property,
  }));
}

// The codes of the shared guards (`platform/http.ts`, `parseBody`) join the codes that the route lists; a public
// route has no session guard.
function errorAnswers(spec: ApiDocSpec): Map<ApiErrorStatus, { codes: string[]; schema: ZodType | undefined }> {
  const shared: { status: ApiErrorStatus; codes: readonly string[]; schema?: ZodType }[] = [
    ...(spec.body || spec.query ? [{ status: 400 as const, codes: ["validation"] }] : []),
    ...(spec.public ? [] : [{ status: 401 as const, codes: ["unauthorized"] }]),
    {
      status: 403,
      codes: [...(spec.public ? [] : ["no_organization", "org_suspended"]), "bad_origin"],
    },
    { status: 413, codes: ["too_large"] },
  ];
  const merged = new Map<ApiErrorStatus, { codes: string[]; schema: ZodType | undefined }>();
  for (const { status, codes, schema } of [...(spec.errors ?? []), ...shared]) {
    const before = merged.get(status);
    merged.set(status, {
      codes: [...new Set([...(before?.codes ?? []), ...codes])],
      schema: before?.schema ?? schema,
    });
  }
  return merged;
}

export function apiDoc(spec: ApiDocSpec): MiddlewareHandler {
  const json = (schema: ZodType) => ({ "application/json": { schema: resolver(schema) } });
  const responses: NonNullable<DescribeRouteOptions["responses"]> = {
    [spec.ok.status]:
      "schema" in spec.ok ? { description: "OK", content: json(spec.ok.schema) } : { description: "No content" },
  };
  if (spec.alsoOk) responses[spec.alsoOk.status] = { description: "OK", content: json(spec.alsoOk.schema) };
  for (const [status, { codes, schema }] of errorAnswers(spec)) {
    responses[status] = { description: `Error codes: ${codes.join(", ")}`, content: json(schema ?? apiErrorSchema) };
  }
  return describeRoute({
    operationId: spec.operationId,
    summary: spec.summary,
    tags: spec.tags,
    responses,
    ...(spec.body ? { requestBody: { required: true, content: json(spec.body) } } : {}),
    ...(spec.params || spec.query
      ? {
          parameters: [
            ...(spec.params ? parameters(spec.params, "path") : []),
            ...(spec.query ? parameters(spec.query, "query") : []),
          ],
        }
      : {}),
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
