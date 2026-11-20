// The OpenAPI file of the public docs site (ADR 0023; ticket folder spec/features/active/F121-e10b-public-pages-and-demo): built from the app with fakes, so it cannot drift from the routes.
// `scripts/api-spec.ts` writes or checks the file; the drift test calls the same functions.
import { join } from "node:path";

import { buildFakeApp } from "../../openapi-app";
import { openApiSpec } from "../../platform/openapi";

/** The committed file, relative to the repository root. */
export const SPEC_FILE = "docs/api/openapi.json";

/** The repository root, for the default place of the file. */
export const REPO_ROOT = join(import.meta.dir, "../../../../..");

/** The public spec: no operator, auth, callback or file route (`EXCLUDED_PATHS`, `hide`); no server URL; version `"0"`. */
export async function buildPublicSpec(): Promise<object> {
  return openApiSpec(buildFakeApp());
}

/** The bytes of the file: 2-space JSON and one newline at the end. */
export function renderSpec(spec: object): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

export async function buildSpecText(): Promise<string> {
  return renderSpec(await buildPublicSpec());
}

export const apiSpecUsage = "usage: bun run api:spec [--check]";

/** `{ check }`, or null on any bad argument (the script prints the usage). */
export function parseApiSpecArgs(argv: string[]): { check: boolean } | null {
  if (argv.length === 0) return { check: false };
  if (argv.length === 1 && argv[0] === "--check") return { check: true };
  return null;
}
