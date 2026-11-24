import { useEffect, useState } from "react";

import { loadSections } from "./sections";

// Every file in `sections/` is one section; there is no list of them here. A new section is a new file.
const SECTIONS = loadSections(import.meta.glob("./sections/*.tsx", { eager: true }));

// The pattern page: every primitive and pattern in each variant, for the eye and for the generic e2e spec
// (`apps/web/e2e/tests/patterns.spec.ts`). It makes no API call and is not in the production build. The demo texts are English
// literals on purpose: the page is not part of the panel text rules.
export default function PatternsPage() {
  // The page is in the server HTML, so a spec must not click before the buttons have their handlers.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <main data-hydrated={hydrated} className="mx-auto flex max-w-5xl flex-col gap-12 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Pattern page</h1>
        <p className="text-muted-foreground">
          Every primitive and pattern of the panel, in each variant. This page is in the dev build only.
        </p>
      </header>
      {SECTIONS.map((section) => (
        <section key={section.id} aria-labelledby={`section-${section.id}`} className="flex flex-col gap-4">
          <h2 id={`section-${section.id}`} className="text-xl font-semibold">
            {section.title}
          </h2>
          {section.render()}
        </section>
      ))}
    </main>
  );
}
