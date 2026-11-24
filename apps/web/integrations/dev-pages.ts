// Astro integration: the pattern page (`src/dev/patterns.astro`) is a route of the dev build only.
// `EA_DEV_PAGES=1` turns it on; only `bun run web:build:dev` and `bun run web:dev` set it. The image build (`web:build`) and the
// release script never do, so a production `dist` holds no `/dev` folder. The page is in `src/dev`, not in `src/pages`, so Astro adds
// it only through this hook. It makes no API call and the server treats it like every other panel page: a visitor with no session
// is sent to `/login`.
import type { AstroIntegration } from "astro";

export const DEV_PAGES_VARIABLE = "EA_DEV_PAGES";
export const PATTERNS_PATTERN = "/dev/patterns";

export default function devPages(env: Record<string, string | undefined>): AstroIntegration {
  return {
    name: "ea-dev-pages",
    hooks: {
      "astro:config:setup": ({ injectRoute }) => {
        if (env[DEV_PAGES_VARIABLE] !== "1") return;
        injectRoute({ pattern: PATTERNS_PATTERN, entrypoint: new URL("../src/dev/patterns.astro", import.meta.url) });
      },
    },
  };
}
