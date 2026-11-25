# F172 cold review 1: one line per finding

Review: [`plan-review-1.md`](plan-review-1.md) (FAIL at `867ab63b1`). Fixed 2026-11-25. Stage numbers below are the new ones: old 03 split into 03 (verdicts) and 04 (fixes); old 04, 05, 06 are now 05, 06, 07. No second review round (coordinator task).

| Finding | Fix |
| --- | --- |
| B1 gate checks presence, not validity | P1 rewritten: stage 06 step 1.1 compares the run time with the expiry (2026-11-25 18:00 Europe/Warsaw); after it, asks for "go" and does not start without it. Ticket acceptance, Slices and Sequenced agree. questions.md 1. |
| B2 font token deleted | Stage 01 step 3 rule: `--font-sans`, `--font-mono` always used; `--<token>--<modifier>` follows its token. Tests 4 and 5. |
| B3 card acceptance unreachable | Ticket outcome and acceptance changed to P3: card behind `docs_links`, once per browser, stage 06 records the flag state. questions.md 3. |
| B4 T10 cannot fail | Stage 05 step 3: new T10 case on a copy with `[Unreleased]` renamed; break test proves the old case misses it. Stage 06 step 2 runs T10 after `release:prepare`, before `git commit`. |
| G1 bare `shadow` | Stage 02 step 1: guard matches only `shadow-<stock size>` not after a letter, digit or `-`; bare `shadow` is a by-eye sweep marker. Test 5 covers `box-shadow`, `shadow: {…}`, `"shadow"`. questions.md 15. |
| G2 arbitrary shadows | Stage 02 step 1: guard rule "an arbitrary shadow" (`shadow-[`); `--shadow-button`, `--shadow-bar` tokens with ADR rows. questions.md 14. |
| G3 `dev/` importer | D9: a `dev/` import counts. Stage 01 step 2 test 4; stage 01 does not edit `components/ui/` or `dev/`. questions.md 12. |
| G4 `@/` alias | Stage 01 step 2: the guard resolves `@/`; test 3. |
| G5 parallel stages share files | D10: stage 02 runs after stage 01; ownership written in both Needs lines; `web-panel.md` § Look owned by stage 05 alone. questions.md 13. |
| G6 no-organization card | Stage 03 adds its row; stage 04 step 2 takes the pictures with a throwaway `/api/me` stub, no seed change. questions.md 11. |
| G7 ADR match form | Stage 02 step 4: path under `apps/web/src/` in backticks, the same form as the lists; ADR text uses paths. |
| G8 plurals | Stage 01 step 1 reads `enPlurals`, `plPlurals`; test 4. |
| G9 count pin | Stage 05 step 3 test 3 uses a fixture; no test pins the real `[Unreleased]` count; the new T10 case passes on an empty `[Unreleased]`. |
| C1 | Same fix as B1. |
| C2 `bun.lock` without a stop | D3: stage 02 step 3 runs only with "remove next-themes: yes" in the task; else skipped and reported. questions.md 4. |
| C3 20-draft record vs PB-12 | P2: counts only before the expiry (standing rule bypasses blockers); after it, the "go" question asks. Stage 06 step 1.1. |
| C4 watch is no stop vs trigger | Stage 06 step 5.5: a trigger inside the window leads to rollback at once; the rest is a record. |
| F1 no overlay shadow in ADR | Stage 02 step 1: overlays use `shadow-card`; no overlay token. |
| F2 T10 is a net | P6 reason rewritten: the author and the Opus review hold the rule; T10 catches literal parts of 7 or more characters only. |
| F3 `/dev/patterns` curl | Stage 06 step 5.3: list the web `dist` inside the server container; the unsigned curl step is gone. |
| F4 CI wake | Stage 06 step 3: background `gh run watch` per run into `~/ea-logs/v0.5.0/ci.log`; read at the next turn (a job wake or the owner's message). |
| S1 stage 03 too big | Split: stage 03 writes verdicts only (no code, no review job); stage 04 fixes, takes the no-organization pictures, reruns the changed routes, runs `test:e2e`. Both 150 min. |
| N1 lint of study files | Stage 05 step 1 and stage 07: stage 07 step 1 runs in the same coordinator turn as the stage 05 land; plan.md § How to run says so. |
| N2 range in Needs | Stage 01 Needs line says the range is the real dependency (the guards scan every panel file). Stage 02 now needs stage 01 only. |
| N3 watch script path | Stage 06 step 5.5 names `~/ea-logs/v0.4.5/watch.sh`. |

Rejected: none.
