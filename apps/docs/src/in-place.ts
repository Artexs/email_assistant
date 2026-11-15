// Operator docs read in place (ADR 0030 point 3, plan D5): the site page is the repository file itself, never a copy.
// The loader renders each source at build time; `rewriteLinks` makes its relative links work on the site.
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { docsLoader } from "@astrojs/starlight/loaders";
import { DOCS_BASE } from "@ea/core";
import type { Loader } from "astro/loaders";
import { mapOutsideCode, stepFence } from "./markdown-code";

export interface InPlacePage {
  readonly id: string;
  // From the repository root.
  readonly path: string;
}

// Order = order in the sidebar section "Operate".
export const IN_PLACE_PAGES: readonly InPlacePage[] = [
  { id: "operate/install-and-run", path: "deploy/README.md" },
  { id: "operate/release-checklist", path: "docs/release-checklist.md" },
];

// The sidebar section that lists the in-place pages. A sidebar built from the files would group them by their folders.
export const IN_PLACE_SECTION = "Operate";

export const REPO_URL = "https://github.com/Artexs/email_assistant";
const DEFAULT_REF = "master";
const REF_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// The repository root. `EA_DOCS_REPO_ROOT` points the loader and the checks at a fixture tree (tests only).
export function repoRoot(): string {
  return process.env.EA_DOCS_REPO_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url));
}

// The git ref in the GitHub links: env `DOCS_GIT_REF` (the deploy sets the tag), else `master`.
export function docsGitRef(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const ref = env.DOCS_GIT_REF === undefined || env.DOCS_GIT_REF === "" ? DEFAULT_REF : env.DOCS_GIT_REF;
  if (!REF_SHAPE.test(ref) || ref.includes("..")) throw new Error(`in_place_ref ${ref}`);
  return ref;
}

// Absolute paths of the sources, for the content-script check of `cspFinalize`.
export function inPlaceSourcePaths(root: string = repoRoot()): string[] {
  return IN_PLACE_PAGES.map((page) => join(root, page.path));
}

export function inPlaceSitePath(id: string): string {
  return `${DOCS_BASE}/${id}/`;
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// `](destination "title")`: the opening `[` can sit before a code span, so only `](` is matched.
const INLINE_LINK = /(\]\()(<[^>\n]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)((?:\s+(?:"[^"]*"|'[^']*'))?\s*\))/g;
const LINK_DEFINITION = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>\n]*>|\S+)/;

function rewriteTarget(target: string, sourcePath: string, ref: string): string {
  if (target.startsWith("//") || SCHEME.test(target)) return target;
  const suffixAt = target.search(/[?#]/);
  const pathPart = suffixAt === -1 ? target : target.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? "" : target.slice(suffixAt);
  // A pure `#anchor` (or `?query`) link stays.
  if (pathPart === "") return target;
  // `/x` is relative to the repository root, as on GitHub.
  const resolved = pathPart.startsWith("/")
    ? posix.normalize(pathPart.slice(1))
    : posix.normalize(posix.join(posix.dirname(sourcePath), pathPart));
  if (resolved === ".." || resolved.startsWith("../"))
    throw new Error(`in_place_link_outside ${target} in ${sourcePath}`);
  const page = IN_PLACE_PAGES.find((candidate) => candidate.path === resolved);
  if (page) return `${inPlaceSitePath(page.id)}${suffix}`;
  const kind = pathPart.endsWith("/") ? "tree" : "blob";
  return `${REPO_URL}/${kind}/${ref}/${resolved.replace(/\/$/, "")}${suffix}`;
}

function rewriteDestination(destination: string, sourcePath: string, ref: string): string {
  if (destination.startsWith("<") && destination.endsWith(">")) {
    return `<${rewriteTarget(destination.slice(1, -1), sourcePath, ref)}>`;
  }
  return rewriteTarget(destination, sourcePath, ref);
}

// Rewrites the relative links of a Markdown source (inline links, images and link definitions; not code).
// A link to another in-place source becomes its site path; a link to another repository file becomes a GitHub link at `ref`.
// Absolute URLs and `#anchor` links stay. A link that leaves the repository root throws `in_place_link_outside`.
export function rewriteLinks(markdown: string, sourcePath: string, ref: string): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const step = stepFence(fence, line);
      fence = step.fence;
      if (step.code) return line;
      const definition = LINK_DEFINITION.exec(line);
      if (definition) {
        const [whole = "", head = "", destination = ""] = definition;
        return `${head}${rewriteDestination(destination, sourcePath, ref)}${line.slice(whole.length)}`;
      }
      return mapOutsideCode(line, (text) =>
        text.replace(
          INLINE_LINK,
          (_whole, open: string, destination: string, close: string) =>
            `${open}${rewriteDestination(destination, sourcePath, ref)}${close}`
        )
      );
    })
    .join("\n");
}

// The title (text of the first `# ` line outside a code fence) and the body (the source without that line).
export function splitSource(text: string, path: string): { title: string; body: string } {
  const lines = text.split("\n");
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const step = stepFence(fence, line);
    fence = step.fence;
    if (step.code) continue;
    const heading = /^# (.+?)\s*$/.exec(line);
    if (heading) {
      const title = heading[1] ?? "";
      return { title, body: [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n") };
    }
  }
  throw new Error(`in_place_source ${path}`);
}

export function readInPlaceSource(page: InPlacePage, root: string = repoRoot()): { title: string; body: string } {
  const file = join(root, page.path);
  if (!existsSync(file)) throw new Error(`in_place_source ${page.path}`);
  return splitSource(readFileSync(file, "utf8"), page.path);
}

// Starlight's docs loader first, then one store entry per in-place source (probe F6: `filePath` is required).
export function inPlaceLoader(base: Loader = docsLoader()): Loader {
  return {
    name: "ea-in-place",
    load: async (context) => {
      await base.load(context);
      const ref = docsGitRef();
      for (const page of IN_PLACE_PAGES) {
        const { title, body: raw } = readInPlaceSource(page);
        const body = rewriteLinks(raw, page.path, ref);
        const data = await context.parseData({ id: page.id, data: { title } });
        context.store.set({
          id: page.id,
          data,
          body,
          filePath: `../../${page.path}`,
          rendered: await context.renderMarkdown(body),
        });
      }
    },
  };
}
