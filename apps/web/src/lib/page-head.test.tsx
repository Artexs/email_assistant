/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { PageHead } from "../components/patterns/PageHead";

function markup(props: Parameters<typeof PageHead>[0]): string {
  return renderToStaticMarkup(<PageHead {...props} />);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("PageHead", () => {
  test("renders one h1 with the title, the lead and the action", () => {
    const html = markup({ title: "Approvals", lead: "Drafts that wait.", action: <button>Connect</button> });
    expect(count(html, "<h1")).toBe(1);
    expect(html).toContain(">Approvals</h1>");
    expect(html).toContain("Drafts that wait.");
    expect(html).toContain("<button>Connect</button>");
  });

  test("renders the h1 only when there is no lead and no action", () => {
    const html = markup({ title: "Approvals" });
    expect(count(html, "<h1")).toBe(1);
    expect(count(html, "<p")).toBe(0);
    expect(count(html, "<button")).toBe(0);
  });

  test("hides the lead below lg only when an action is present", () => {
    expect(markup({ title: "A", lead: "Lead", action: <span>x</span> })).toContain(
      'class="mt-1.5 text-muted-foreground hidden lg:block"'
    );
    expect(markup({ title: "A", lead: "Lead" })).toContain('class="mt-1.5 text-muted-foreground "');
  });
});

// The shell owns the one h1 of a page. Auth pages and the screen for a user with no organization have no shell around them.
const H1_ALLOWED = [
  "components/patterns/PageHead.tsx",
  "components/shell/AppShell.tsx",
  "components/auth/AuthCard.tsx",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("page title owner", () => {
  test("no island or feature component renders an h1 except the allowed files", () => {
    const src = join(import.meta.dir, "..");
    const found = [...sourceFiles(join(src, "islands")), ...sourceFiles(join(src, "components"))]
      .filter((file) => readFileSync(file, "utf8").includes("<h1"))
      .map((file) => relative(src, file))
      .sort();
    expect(found).toEqual([...H1_ALLOWED].sort());
  });
});
