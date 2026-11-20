# F143 stage 04 — web composition root by part

Needs: nothing. May run next to every other stage (stage 03 imports only `webDeps` from `./web`).
Part of [`../plan.md`](../plan.md).

## Goal

`apps/server/src/web.ts` (629 lines) becomes four root files by part. `./web` still exports all 19 names (D7, D10).

## Step 1 — the split

- **Files** (all in `apps/server/src/`, so the root lint globs `apps/server/src/*.ts` cover them):
  - `web-audit.ts`: the auth event table and the audit handlers (`auditWebEvent`, `auditSsoEvent`, `termsAcceptedHandler`, `authMailFailedHandler`).
  - `web-route-deps.ts`: the route dependency builders (`scopeInfos`, `scopeEnvOf`, `countMailboxes`, `approvalsWaiting`, `onboardingDeps`, `homePathOf`, `statsRouteDeps`, `settingsRouteDeps`) and the private helper they use; `distPath` and `peerAddress`.
  - `web-routers.ts`: `WebExtras`, `apiRouters` (the route mount list), `apiPublicRouters`.
  - `web.ts`: `WebRuntime`, `webDeps`, and a re-export by name of every other export. Nothing else.
- The mount order inside `apiRouters` and `apiPublicRouters` does not change (Hono matches in order).
- If a part is still over 400 lines, split it by route area, not into a helper file.
- **Method:** D5. Copy the F091 scripts to `/tmp/f143-s04/`; `history-copies.sh` with the target dir `apps/server/src` and the three new names; trim right after the history merge. Adapt the `/tmp` copy of `same-bodies.ts` so it reads `web.ts` and `web-*.ts`, not `repo/*.ts`. D6 if `master` changes `web.ts` first.

## Test

No new test: behaviour does not change. Move proofs in `/tmp/f143-s04/`:

1. `same-bodies.ts` (adapted) on the base `web.ts` against the four files: `SAME_BODIES <n>`, exit 0.
2. `exports-of.ts` of the base `web.ts` equals that of the new `web.ts`: `diff` prints nothing.
3. Each new file: `git log --follow` reaches the first commit of `web.ts`.
4. `git diff --name-only <base> HEAD -- apps/server/test apps/server/src/web.test.ts apps/server/src/main.ts` prints nothing (about 30 integration tests import from `./web` and must not change).
5. `wc -l` of each of the four files ≤ 400.
6. Mutation check: change one string in a copy; the adapted `same-bodies.ts` exits 1 and names it. Revert. Write it in the final message.

The existing integration suite covers the routes (`web-*.test.ts`, `web-tenant-scope.test.ts`); it must pass with no edit.

## Docs

A page in `docs/` that points at a function of `web.ts` by path points at its new file.

## Done when

- Checks 1–6 passed; the logs are named in the final message.
- Proof: `mkdir -p /tmp/f143-s04 && bun run lint > /tmp/f143-s04/lint.log 2>&1 && bun run typecheck > /tmp/f143-s04/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s04/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s04/int.log 2>&1 && echo PROOF_OK`

## Out of scope

`platform/http.ts` (493 lines, warning only). A new route, a changed mount, a renamed export.
