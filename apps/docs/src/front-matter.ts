// Front matter of the docs pages (plan D7): the capabilities a user page describes, and the source of a Polish page.
// The schema is `docsSchema({ extend })`; the rule "a user page names at least one existing capability" needs the page id,
// so `frontMatterLoader` applies it to the loaded entries (a schema cannot see the id).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "astro/zod";
import type { Loader } from "astro/loaders";
import { repoRoot } from "./in-place";

// A page whose id starts with one of these (also under `pl/`) is a user page.
export const USER_SECTIONS = ["start", "how-to", "reference", "explanation", "faq"] as const;

// The English page ids that need a Polish page (plan P6): the landing page, the tutorial, every how-to guide, the FAQ and
// "How a mail is sorted". The reference and the operator pages stay English only (Starlight fallback).
export const POLISH_SET: readonly string[] = [
  "index",
  "start",
  "how-to/approve-a-send",
  "how-to/correct-a-category",
  "how-to/delegate-and-follow-up",
  "how-to/digest-times",
  "how-to/language",
  "how-to/mode-and-switches",
  "how-to/pause",
  "how-to/sender-rules",
  "how-to/two-factor",
  "how-to/undo-a-move",
  "faq",
  "explanation/how-a-mail-is-sorted",
];

export const SOURCE_HASH_SHAPE = /^[0-9a-f]{16}$/;

export const frontMatterFields = {
  // File names in `docs/capabilities/` without `.md`.
  capabilities: z.array(z.string()).optional(),
  // The English page id of a Polish page, for example `start`.
  source: z.string().optional(),
  // 16 lowercase hex: the hash of the English body when the Polish page was last checked (`bun run docs:stale --stamp`).
  sourceHash: z.string().regex(SOURCE_HASH_SHAPE, "sourceHash must be 16 lowercase hex characters").optional(),
};

export const frontMatterSchema = z.object(frontMatterFields);

// The page id without the language folder: `pl/how-to/x` → `how-to/x`.
export function englishId(id: string): string {
  return id.startsWith("pl/") ? id.slice(3) : id;
}

export function isUserPage(id: string): boolean {
  const first = englishId(id).split("/")[0] ?? "";
  return (USER_SECTIONS as readonly string[]).includes(first);
}

// The names of the capability pages: the files of `docs/capabilities/` without `.md`. `README.md` is the index, not a capability.
export function capabilityNames(root: string = repoRoot()): ReadonlySet<string> {
  const dir = join(root, "docs/capabilities");
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .map((name) => name.slice(0, -3))
  );
}

// `front_matter capabilities <id>` when a user page has no capability, or any page names a capability that has no file; else null.
export function frontMatterProblem(
  id: string,
  data: { capabilities?: readonly string[] | undefined },
  known: ReadonlySet<string>
): string | null {
  const capabilities = data.capabilities ?? [];
  if (isUserPage(id) && capabilities.length === 0) return `front_matter capabilities ${id}`;
  if (capabilities.some((name) => !known.has(name))) return `front_matter capabilities ${id}`;
  return null;
}

// Wraps a loader: after it loaded, every entry passes `frontMatterProblem`. The first problem fails the build.
export function frontMatterLoader(base: Loader, root: () => string = repoRoot): Loader {
  return {
    name: "ea-front-matter",
    load: async (context) => {
      await base.load(context);
      const known = capabilityNames(root());
      for (const [id, entry] of context.store.entries()) {
        const problem = frontMatterProblem(id, entry.data as { capabilities?: readonly string[] }, known);
        if (problem) throw new Error(problem);
      }
    },
  };
}
