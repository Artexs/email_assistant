// @ts-check
import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import cspStyleSrc from "./integrations/csp-style-src";

// https://astro.build/config
export default defineConfig({
  output: "static",
  integrations: [react(), cspStyleSrc()],
  build: { inlineStylesheets: "never" },
  // No Markdown in the panel; Shiki inline styles clash with the CSP (ticket F101, D3).
  markdown: { syntaxHighlight: false },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    server: { proxy: { "/api": { target: "http://127.0.0.1:8080", timeout: 95_000 } } },
  },
});
