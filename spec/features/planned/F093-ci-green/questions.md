# F093 · open questions (small; defaults taken, owner to confirm)

None of these blocks the stages. Each default is in `plan.md`.

## Q1 Upgrade Bun in the server image now?

- **Fact:** CI and the image run Bun 1.3.14; this PC and every Limen worker run 1.4.4 (`plan.md` F4). Five tests hung on 1.3.14 only. Bun 1.3.14 also checks a STARTTLS certificate against `localhost` when the mail host is an IP address (F7); DNS host names are fine.
- **Options:** (a) keep 1.3.14 in F093, pin it in `.bun-version`, and open a follow-up ticket "The server image, CI and local checks run one current Bun (1.4.x)" with a deploy step; (b) upgrade to 1.4.4 inside F093 (adds a deploy stage and a production check).
- **Default:** (a), decision D5. F093 changes no production runtime. The follow-up removes `DNS:localhost` from the STARTTLS test certificate (D9) and checks NV3.

## Q2 Every later worker proves on the pinned Bun?

- **Fact:** `bun run test:unit:ci` takes about 54 s locally against 29 s for `bun run test:unit` (F4); `bunx` downloads the pinned Bun once (F8).
- **Default:** yes, decision D6. Stage 3 changes the check line in the styleguide, `CLAUDE.md` and `docs/code-patterns.md` to the `:ci` scripts. Plans of later tickets that name `bun run test:unit` in their Proof should switch to `test:unit:ci` and `test:int:ci` when they are planned or built.

## Q3 Close F093 only after three green runs?

- **Default:** yes, decision D14. The last stage lands with `--keep-open`; the coordinator runs `limen ticket done F093` when `gh run list` shows three green runs with `attempt` 1.
