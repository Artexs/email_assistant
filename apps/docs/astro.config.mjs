// @ts-check
import starlight from "@astrojs/starlight";
import { DOCS_BASE, DOCS_ORIGIN, PRODUCT_NAME } from "@ea/core";
import { defineConfig } from "astro/config";
import cspFinalize from "./integrations/csp-finalize";

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
    // After Starlight: it hashes Starlight's inline scripts and checks every page's CSP (plan D3).
    cspFinalize(),
  ],
  // Astro hashes its own scripts and styles. `cspFinalize` hashes the rest and relaxes `style-src`.
  // No `frame-ancestors`: a meta CSP ignores it (plan Q6). No `'unsafe-eval'` or `'wasm-unsafe-eval'`: Pagefind needs neither.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ],
    },
  },
});
