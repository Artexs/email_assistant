# F106 stage 11 — Playwright: the delete flow

Part of [`../plan.md`](../plan.md).

## Step 1 — a seeded organization and the spec

**Goal.** A real browser proves the dialog, the delete and the login notice, at desktop and phone width.

**Files.** `apps/server/src/scripts/e2e-seed.ts` (a delete-only organization); `apps/web/e2e/tests/account-delete.spec.ts`; e2e helpers if needed.

**Decisions.** P1, P6, D5.

- The seed adds one organization per width project, used by no other spec: "E2E Delete Desktop" and "E2E Delete Phone", each with one owner, one mailbox (`del-<width>@x.test`), the flag `org_delete` on, and a few mail rows. Owners sign in with the seed password. A spec that deletes data must never touch the shared seed organizations.
- Each sign-in in its own browser context; client addresses from a free `nextAddress` block at `HEAD` (F105 took 50 and 150).

**Test** (the spec, per width):

1. Settings → Account: the delete button shows for the owner.
2. Open the dialog: the submit stays disabled for a wrong name; type the name in lower case → enabled.
3. A wrong password → `del_wrong_password` text; the organization still loads after closing the dialog.
4. The right password → the page goes to `/login?deleted=1`, shows `del_done_title` and the mailbox address of the seed.
5. A reload shows the texts and no address.
6. Signing in again with the deleted owner fails with the usual wrong-login text.
7. The owner of the main seed organization (flag off) sees no delete button.
8. No browser console line holds the password.
9. Polish: with the browser language `pl`, step 1 shows `Usuń organizację`.

**Check.** Give the job its own e2e database first (the commands in `CLAUDE.md` § Rules and the F105 plan rule): `sed -i -E '/^E2E_(MIGRATOR_)?DATABASE_URL=/d' .env`, then `bun run db:worktree f106_s11_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env`. Never use the shared e2e database.

**Proof.**

```
mkdir -p /tmp/f106-s11 && bun run lint > /tmp/f106-s11/lint.log 2>&1 && bun run typecheck > /tmp/f106-s11/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f106-s11/unit.log 2>&1 && bun run web:build > /tmp/f106-s11/web.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f106-s11/e2e.log 2>&1 && echo PROOF_OK
```

The whole e2e suite runs: the seed change touches every spec.

**Done when.** The spec passes at both widths and the Proof prints `PROOF_OK`.

**Out of scope.** e2e for the CLIs (integration tests cover them).
