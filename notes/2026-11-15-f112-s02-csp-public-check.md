# F112 stage 02: CSP and public-content check (notes for stages 03 and later)

- `cspProblem`, `docsCspProblem`, `inlineScripts`, `scriptHashSource` and `publicContentProblems` / `publicContentScan` / `parseAllowList` live in `@ea/core/web` (`packages/core/src/web/csp.ts`, `public-content.ts`). `sha256.ts` is a plain TypeScript SHA-256, because this folder pulls no Node module; the test compares it with `node:crypto`.
- `script_hash_missing` is the last check of `cspProblem`. A script element is governed by `script-src-elem` when the meta has it, else by `script-src`.
- Docs integrations (order in `apps/docs/astro.config.mjs`: Starlight, `cspFinalize()`, `publicContent()`): `integrations/csp-finalize.ts`, `integrations/public-content.ts`. Build log lines: `csp checked in <n> page(s)`, `public content checked in <n> file(s)`.
- Stage 03: pass the absolute paths of the `IN_PLACE_PAGES` sources as `cspFinalize({ extraContentFiles })`. The content scan (`content_script <file>:<line>`) runs in `astro:config:setup`, before the build; it reads `src/content/docs` only until stage 03 adds them.
- Stage 03: when the in-place pages arrive, the check will probably fail on the F8 strings. Known: `a@b.com.pl`, `p@x.test.vcf` (R2: the domain `x.test.vcf` and `b.com.pl` are not reserved), `100.100.100.100` (R3). Add them to `apps/docs/public-content-allow.txt` with a reason. `a@b.com` and `p@x.test` need no entry only if the match is the whole address (`p@x.test` passes as `.test`; `a@b.com` needs an entry).
- `apps/docs/public-content-allow.txt` holds 16 translator credits (emails) that Starlight 0.43.1 bundles with Pagefind UI in `_astro/ui-core.*.js`. A Starlight update that changes the credits fails the build with `public_content R2` or `unused_allow`: review the new strings, then edit the list.
- R6 matches `plausible` as a plain word (the plan lists it as a tracker name). A page that uses the English word fails: write another word, or allow-list the exact match with a reason.
- Content rule ` on<letters>=` also matches prose such as `online = x`; reword it.
- R1 needs a real label before `.ts.net`; `bob.<tailnet>.ts.net` (a real machine name with a placeholder tailnet) passes.
- Mutation runs: `/tmp/f112-s02/mutate.py`, summary `/tmp/f112-s02/mutation-summary.log` (33 guards, all killed).
