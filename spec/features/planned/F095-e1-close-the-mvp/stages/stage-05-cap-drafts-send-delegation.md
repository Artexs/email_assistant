# F095 stage 05 — Pages `drafts-and-send.md` and `delegation.md`

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D4–D7, D19. Read "Rules for every stage" and the method box of [`stage-03-cap-sync-triage.md`](stage-03-cap-sync-triage.md) ("How to write a page", items 1–8) first.

Two pages: the draft, approval and send path, and delegation tracking. This stage moves the most text (rule 6 detail and all of §4.5). Three steps. Docs only.

## Step 1 — `docs/capabilities/drafts-and-send.md` ("Drafts and send")

- **Goal:** an agent knows how a draft is made, how the user approves it, how the send runs exactly once at most, and every error outcome.
- **Seams:** `apps/server/src/modules/actions/` (`drafts.ts`, `send.ts`, `approvals.ts`, `expiry.ts`), `apps/server/src/modules/mail/imap/smtp.ts`, `packages/core/src/outgoing/` (templates, quote, message, sender), `packages/core/src/digest/approvals.ts`, `apps/server/src/modules/channels/callbacks.ts` (the approval taps), `apps/server/src/scripts/mailbox-probe-send.ts`; ADR 0003.
- **Must cover:** draft kinds today (delegation, clarification, reminder; check the code), the template and the quote, `style_text` if the code reads it, `create_draft` with `X-EA-Action-Id`, the approval message and the taps, `SEND_SCOPE` (`off`, `self`, `all`) and `SEND_TEST_ADDRESSES`, the 48 h approval rule, the send at most once, the Sent copy, the error outcomes, "Send again", "It went out", the `actions.expiry` job and its schedule.
- **Moves from `architecture.md`:**
  - §4.1 rule 6: the bullets `create_draft`, `send`, **SMTP stage**, **"Send again"**, **"It went out"**, the paragraph and table "Outcomes of a send error (rule 6, `sendOutcomeOf`)", the compose-error line and the "soft cap" paragraph → "Rules". Rule 6 keeps its headline lines and gets one link line.
  - §4.5 (Approval flow): the whole body (sequence diagram and bullets) → "Rules" (the diagram as a fenced `mermaid` block). The heading stays with one link line. The bullet "Reminder sets" goes into `delegation.md` instead, and `drafts-and-send.md` links it.
  - §8: from the bullet "S4 jobs", the `actions.expiry` part → "Rules". The `delegation.chaser` part goes to step 2. The `bun run job:run` sentence goes to `drafts-and-send.md` "Entry points" (and `delegation.md` links it).
- **Limits (at least):** no free-text reply drafts (E6a F115); edits in the mail client do not count (PD-076, E6a); no web approval page (E4-A F102); no send limits (E7-T2 F099, PD-044).
- **Decisions:** ADR 0003, 0005, 0010; PD-031, PD-044 (Limits only).
- **Tests:** `apps/server/test/integration/actions-drafts.test.ts`, `actions-send.test.ts`, `actions-approvals.test.ts`, `actions-resume-approvals.test.ts`, `actions-close.test.ts`, `smtp-send.test.ts`, `actions-send-logs.test.ts`, and the core tests of `packages/core/src/outgoing/`.
- **Done when:** the page exists; method items 1–8 hold.

## Step 2 — `docs/capabilities/delegation.md` ("Delegation")

- **Goal:** an agent knows how a mail becomes a delegation, how the reply is found, and how the chaser reminds.
- **Seams:** `apps/server/src/modules/delegation/` (`index.ts`, `service.ts`, `repo.ts`, `chaser.ts`), the delegation planner in `packages/core` (find it from `index.ts`), scripts `delegates.ts`, `delegations.ts`; the "reply in a delegation thread" branch of the §4.1 flow (stays; link it).
- **Must cover:** delegates (`bun run delegates:add`, `delegates:list`, `delegates:disable`, `delegates:enable`; tags), how the classifier picks a delegate id from the list (link `triage.md`), delegation rows and `due_at`, reply detection in the thread, the `delegation_answered` notice and the Done tap, the chaser job (schedule, 07:30 local, reminder sets, "Send all"), `bun run delegations:list` and `delegations:done`.
- **Moves from `architecture.md`:**
  - §4.4: the bullet "Digest lines for delegations (S4)" → "Rules".
  - §4.5: the bullet "Reminder sets" → "Rules" (from step 1).
  - §4.6: the `delegations.status:` block → "Data" (fenced block). §4.6 now has only its heading and link lines.
  - §8: the `delegation.chaser` part of "S4 jobs" → "Rules".
- **Limits (at least):** no manual delegation and no delegate reply from another address (E5b F116, PD-121, PD-124); no web delegates page (E4-A F102); no delegate import.
- **Decisions:** ADR 0003; PD-124 (Limits only).
- **Tests:** `apps/server/test/integration/delegation-service.test.ts`, `delegation-chaser.test.ts`, `delegation-repo.test.ts`.
- **Done when:** the page exists; method items 1–8 hold.

## Step 3 — Check `architecture.md`

- **Check:**
  1. `grep -n "Moved to \[\`docs/capabilities/drafts-and-send.md\|Moved to \[\`docs/capabilities/delegation.md" docs/architecture.md` → rule 6, §4.5, §8 for the first page; §4.4, §4.6, §8 for the second.
  2. §4.4, §4.5 and §4.6 hold only their heading and link lines: `awk '/^### 4\.4/,/^## 5\./' docs/architecture.md` shows no other text.
  3. Rule 6 holds only its headline lines and one or two link lines.
- **Done when:** the checks hold and `bun test apps/server/src/capability-map.test.ts` → 0 fail.

## Review focus

The send-outcome table and the soft-cap rule moved whole (diff the removed lines against the page). Ten claims against the code, at least four about `send.ts` and `approvals.ts`. No rule of §4.5 is lost between the two pages.

## Done when

- Steps 1–3 hold.
- The Proof command of `plan.md` (`/tmp/f095-s05`, files: `docs/capabilities/drafts-and-send.md docs/capabilities/delegation.md docs/capabilities/README.md docs/architecture.md` plus each other `.md` file whose references you changed) prints `PROOF_OK`.
