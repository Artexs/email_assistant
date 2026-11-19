---
opened: 2026-11-18
---

# F134 · One-click unsubscribe checks that the DKIM signature covers the List-Unsubscribe headers

## Outcome

A newsletter sender counts as one-click (RFC 8058) only when a DKIM signature that the receiving server verified covers the `List-Unsubscribe` and `List-Unsubscribe-Post` headers of the stored mail. Today the system trusts a `dkim=pass` for the sender domain and does not check what the signature covers, so a replayed signed mail with forged header lines could point the unsubscribe request at another host. This closes the one limit of the one-click unsubscribe (F110) that the owner accepted for now.

## Scope

- Header capture stores the `d=` domain and the `h=` header list of the `DKIM-Signature` headers of a mail (new captured data, an expand-only migration with the privacy maps).
- The one-click rule requires a signature whose domain equals the trusted `header.d` and whose header list names both List-Unsubscribe headers.
- Mail stored before the change has no proof and is link-only until a newer mail arrives.

## Out of scope

- Verifying signatures cryptographically in our code: the trusted receiving server did that.
- The other one-click limits (newest mail decides, NAT64 refusal, the domain limit).

## Acceptance

- A mail with `dkim=pass` and a signature whose `h=` lacks `list-unsubscribe-post` is not one-click.
- A mail whose signature domain differs from the passing `header.d` is not one-click.
- A mail with both headers in `h=` and a matching domain stays one-click.
- `bun run db:check-migrations` and the privacy map tests pass.
- `docs/capabilities/trust.md` § Limits no longer lists the replay limit.

## Notes

- Seams: `modules/mail/imap/capture.ts` (`headerCount` already drops a mail with a repeated header), `packages/core/src/triage/dkim-pass.ts`, `modules/triage/newsletter-senders.ts`.
- Source: stage 24 review of F110, NOTE 1 (`spec/features/active/F110-e4-b-earn-trust/review-24.md`), and the owner decision of 2026-11-18 in `docs/owner-decisions.md`. The flag `bulk_unsubscribe` stays off until this lands or the owner accepts the limit.
