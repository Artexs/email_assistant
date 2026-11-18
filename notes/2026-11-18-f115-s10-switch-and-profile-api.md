# F115 stage 10: the switch and the profile API (2026-11-18)

What a later agent needs. Stage file: `spec/features/active/F115-e6a-reply-drafts/stages/stage-10-settings-api.md`. Rules: `docs/capabilities/drafts-and-send.md` rule 16, bullets "Switch", "Profile", "Preview".

## Where the code is

- Switch: `config/service.ts` `setToolSwitch` (the D19 guard: `OauthMailboxError`, read before the settings lock) and `closedBy` (`reply_drafts` off → `{ types: [], sends: "replies" }`). Route: `config/routes.ts` (`replySwitchNames`; hidden with the flag `reply_drafts` off; the error → `ValidationError` field `reply_drafts`, message `oauth_mailbox`). CLI: `scripts/mailbox-settings.ts` (exit 1, `refused: oauth_mailbox`). The CLI does not check the flag.
- Close rule: `ExpireFilter.sends` is now `true | "replies" | "others"` (core `triage/expire-filter.ts`). `listAwaitingSendIds(..., { kinds })` filters by payload kind `reply`.
- Profile: core `replies/profile.ts` (`checkProfileInput`, `profileFallbacks`, `resolveReplyStyle`), server `replies/profile.ts` (`updateMailboxProfile`, `getProfileView`), `replies/routes.ts`, `replies/api-docs.ts`, CLI `scripts/mailbox-profile.ts` (needs `--org-id` like every CLI). `draft-one.ts` `styleOf` now calls `resolveReplyStyle`, so the prompt, the preview and the card use one fallback rule.
- Preview: `replies/preview.ts` (`createStylePreview`), the sample mail `packages/core/src/replies/sample-mail.ts`, the count `countMaillessCallsSince` (`audit/repo.ts`). `main.ts` builds it inside the LLM-scope block and passes it to `webDeps` as `extras.stylePreview`; null → `failed` / `llm_off`.

## Choices made here (defaults, none needs the owner)

- **`create_draft` off no longer closes reply sends.** Before, `sends: true` closed every kind. A reply has its own switch (D12, PD-082; `replaceApproval` already gates replies by `reply_drafts`), so `create_draft` off now closes every kind except replies (`sends: "others"`). `mode shadow` still closes all. `config-settings.test.ts` pins `closedBy`.
- **Audit row is flat.** The stage text says the row holds `["display_name"]`. Audit data cannot hold an array (F106 D17, `assertFlatData`), so `fields` is a comma string: `display_name,signature,writing_style`.
- **Preview is hidden (404) while the flag is off; the profile routes have no flag** (the profile is read for every draft kind, D13).
- **Preview limit counts `llm.call` rows** (`drafter-v1`, no `email_id`, quota day), as the stage says; a retry inside one preview is a second row. One preview per mailbox at a time: a second answers 429 `preview_busy` (an in-process set; one server instance), so a burst cannot pass the limit.
- **Preview language:** the org owner's locale (`getOrgOwner`); none reads as Polish. The call uses the LLM client of the drafter and no scope check: the input is the constant sample mail plus the user's own typed texts.
- **`previewStyle(deps, ctx, { mailboxId, userId })` of `interfaces.md` became `createStylePreview(deps)` → `(ctx, mailboxId, values)`**; `userId` had no use. `interfaces.md` is updated.
- **The composed From header** quotes a name only when it must: `From: Anna Nowak <addr>`.

## Tests and proofs

- Integration: `replies-switch.test.ts`, `replies-switch-route.test.ts`, `replies-cli.test.ts`, `replies-profile-routes.test.ts`, `replies-profile-preview.test.ts`; unit: `packages/core/src/replies/profile.test.ts`, `scripts/mailbox-profile-args.test.ts`.
- Mutation proof of every guard: `/tmp/f115-s10/mutations.log` (script `/tmp/f115-s10/mutate.py`; 36 mutants, all killed after two tests were added for the two survivors). The tmp files are not in the repo.

## TERMS_VERSION

No legal text or registry changed, so no bump. The drafter and the preview send the profile text to the model: the privacy claim gap (N6 of the stage 07 review) stays for stage 17 with its one bump.
