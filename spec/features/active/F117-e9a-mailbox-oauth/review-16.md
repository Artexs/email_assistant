# F117 stage 16 review (Opus 5.5, FAIL 890e18c6, repaired)

Model: Opus 5.5, because the stage has new Polish text and a sign-in flow in the panel.

BLOCKING (repaired in a Sonnet continue; a narrow re-review follows):
- B1: a tap on a sign-in button never reached the provider: `startOAuth` sent no body and the stage 07 route answers 400 `invalid_json` on an empty body. The stage text said "no body"; the panel now sends `{}` (stage text corrected). The unit test had pinned the bug (it stubbed `api`).
- B2: `mail-oauth.test.tsx` mocked the shared `ui/dialog` module; a Bun module mock holds for the whole test process and broke `operator-sso.test.tsx` (5 failures, file-order dependent). The dialog body is now its own component and no shared UI module is mocked.

TEST GAP fixed: the page effect (`takeOAuthBanner`) and the dialog's options read had no test (mutations r1 and r2 survived), and no browser run existed: the reviewer's e2e spec (4 tests, axe, keyboard, crafted banner value, replace not push) is adopted as `apps/web/e2e/mailbox-oauth.spec.ts`.

Verified: the URL is assigned only from the same-origin start answer (never from the query or the banner code); no token in the panel storage (the `state` is only in the provider URL); all 15 D11 codes map to a text and an unknown or `__proto__` code gives `oauth_err_failed`; the text goes through `t()` (no `dangerouslySetInnerHTML`); the 14 text keys match the stage file word for word, the Polish is correct; the Google hint and `aria-describedby` are right; no server runtime change, no migration, no `bun.lock` change; csp 19 pages; 20 worker mutations killed.

Notes:
- `oauth_err_admin` ("link below") claims a link that comes only in stage 17: only a hand-made `?oauth=admin_consent_required` URL shows it today (flags off, no provider before stages 17 and 18). Keep stages 17 and 18 before any flag turns on.
- `isBrowsableUrl` took `http:` and any host (not an open redirect: the host comes from the server registry): now `https:` only.
- After a good start `pending` stays true: the dialog could not be closed after Back from the provider when the browser restores the page from the bfcache: a `pageshow` handler resets it.

## Re-review (Opus narrow, PASS 1580bd8b)
B1 and B2 fixed and landed; e2e spec `mailbox-oauth.spec.ts` kills mutations r1–r3. Carry-over to stage 18 (NOTE): the prop `ConnectDialogProps.initialOauthProviders` is now dead (only `ConnectForm` uses it; its comment is wrong): remove it. The real bfcache restore is tested with a synthetic `pageshow` only (low risk).
