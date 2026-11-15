// @ts-check
import starlight from "@astrojs/starlight";
import { DOCS_BASE, DOCS_ORIGIN, PRODUCT_NAME } from "@ea/core";
import { defineConfig } from "astro/config";

// The public docs site (ADR 0030). Starlight's own Expressive Code highlights code, so `markdown.syntaxHighlight` stays on.
export default defineConfig({
  output: "static",
  site: DOCS_ORIGIN,
  base: DOCS_BASE,
  integrations: [
    starlight({
      title: PRODUCT_NAME,
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        pl: { label: "Polski", lang: "pl" },
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/Artexs/email_assistant" }],
    }),
  ],
});
