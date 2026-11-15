# F117 stage 12 review (Opus 5.5, PASS 3c222c7c)

Model: Opus 5.5, because the stage has new Polish text, a message to people (`mailbox_removed`) and handles an OAuth refresh token. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (a Google mailbox whose delete fails after the secret read: no revoke, the mailbox stays `active`; the test named "a failed delete (Google)" was a cross-org `not_found`) and TG2 (the 10 s cap of the revoke is pinned).

Verified: the three worker decisions: (a) the Remove route answers 200 JSON for every mailbox (callers updated, one answer shape for stage 18); (b) the Google notice is queued after the revoke in its own transaction (the stage file forces this order); (c) an unreadable Microsoft secret defaults to `microsoft_work`. Lock order sound (no lock held while waiting for the advisory lock); a hung Google body is also cut by the 10 s deadline (probe); no token in log, answer, notice, audit (canary test 18); the four texts match the table byte for byte, the password text is unchanged; second-org tests 13 and 14; the "equivalent" mutant `getMailbox` without `org_id` stays equivalent (a wrong-address probe still gets 404).

Carry-over for stage 18 (or a follow-up):
- N2: a crash in the gap between the delete commit and the notice (at most the 10 s revoke) loses the notice while the Google token stays valid, and D11 "every owner hears" breaks. Better design: queue the notice inside the delete transaction with `revoked: false` (the safe text that names the page); after a successful revoke update the view of a row that is still pending to `revoked: true`.
- N3: for a personal Microsoft account with an unreadable secret the default page `microsoft_work` (myapps.microsoft.com) does not accept a personal account. When the tenant is unknown use the address domain (outlook.*, hotmail.*, live.*, msn.com -> `microsoft_personal`) or a text that names both pages.
- N1 residual: an old web bundle cached in a browser parses the 200 with `z.undefined()` and shows an error though the remove succeeded (server and web ship in one image: small).
- The web toast `removed_toast` still says "change its password" for an OAuth mailbox (stage 18). Keep stages 17 and 18 before any flag turns on.
- The Microsoft texts tell the owner to withdraw access "now" but never say in plain words that the app keeps access until they do: a stage 18 toast could.
- A refresh that starts between the secret read and the delete can store a rotated token, and Remove then revokes the old one (Google rarely rotates): holding the lock until the delete commits would close it; the stage file says release.
