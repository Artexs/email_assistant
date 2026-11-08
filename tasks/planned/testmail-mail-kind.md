> **Status 2026-11-08 — planned.** Follow-up of `tasks/active/test-mail-traffic.md` (decision D14). Not started.

# Mail kind for testmail mail

## Goal

Mail from the testmail sender counts as test mail for `mailKindFilter` (`eval --real`, the scope gates).
The user's feedback on such mail then does not mix with real labels in `triage_feedback`.

## Why

AgentMail mail has the SES `Message-ID`, not the `@ea-seed.test>` suffix. So it is not "synthetic" for the scope gates.
`TRIAGE_LLM_SCOPE=all` triages it, and `ACTIONS_SCOPE=synthetic` does not act on it.
The Telegram feedback of the user on such mail lands in `triage_feedback` like a real label.

## Options

- (a) A configured sender list `TEST_SENDER_ADDRESSES`. `mailKindFilter` treats mail from these addresses as test mail.
- (b) A header check. The app does not store headers now, so this needs a schema change.

## Risks

- The S3 `ACTIONS_SCOPE=synthetic` claim filter changes: the committer would act on testmail mail. Decide if that is wanted.
- A sender filter also removes the feedback that the user gave on test mail before the change (it is retroactive).
  So this task must land before the next `eval --real` go/no-go decision (S3 `mailbox:settings auto`).

## Done when

- `mailKindFilter` and the scope gates treat testmail mail as test mail, with a test.
- The runbook `evals/testmail/README.md` section 2 no longer says that the mail is not synthetic.
