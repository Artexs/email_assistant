# sync-sort-folders — Stage 10

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's D9, D10, D12 and "Rules for every step" first. Needs stages 3, 6, 7b and 9.

## Stage 10 — Actions: Undo to the source folder, the rescue move, the move marker [risky]

Why risky: exactly-once moves in the user's mailbox (the ensure rule, D5 of S3) and the Undo target change.

- [ ] **10.1 Reverse to `source_folder`; target `inbox`; APPEND transfer for INBOX targets of non-INBOX mail; marker for the rescue**
  - Goal: D10 and D12 in the committer.
  - Files: change `apps/server/src/modules/actions/apply.ts`, `apps/server/src/modules/actions/move.ts`, `apps/server/src/modules/actions/committer.ts`
    (`createFolderResolver`), `apps/server/src/modules/actions/repo.ts` (claim returns `emails.source_folder`; the action view parses `MoveTarget`),
    `apps/server/src/modules/mail/repo.ts` (`updateEmailLocation` param name), and `applyFlag` in `apply.ts` (its location write sets `inbox_uid` when
    `email.folder === email.source_folder`, not when `email.folder === INBOX`; review m1), tests `apps/server/test/integration/actions-move.test.ts`,
    `apps/server/test/integration/actions-undo.test.ts`, `apps/server/test/integration/actions-committer.test.ts`, `apps/server/test/integration/actions-repo.test.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/modules/actions/apply.ts
    export type ResolvableFolderKey = MoveTarget | "drafts" | "sent"; // MoveTarget from @ea/core (stage 3)
    // apps/server/src/modules/actions/repo.ts — ClaimedAction.email gets:
    source_folder: string; // emails.source_folder
    // (inbox_uid keeps its name: the last known UID in source_folder, D3)
    // apps/server/src/modules/actions/move.ts
    export async function ensureMoved(
      provider: MailProvider,
      email: ClaimedAction["email"],
      from: string,
      to: string,
      hints: Hints,
      exclude: EnsureExclude,
      opts: { byAppend: boolean }
    ): Promise<EnsureResult | null>;
    // apps/server/src/modules/mail/repo.ts — updateEmailLocation: the param `inboxUid` is renamed `sourceUid` (it writes emails.inbox_uid)
    ```

  - Decisions:
    - `createFolderResolver.resolve("inbox")` returns `INBOX` at once: no `ensureFolder`, no `folder_map` write, no audit row.
    - `applyMove`: `bad_payload` when a forward payload folder is not a `MoveTarget` (`isMoveTarget`). Forward target = `resolve(folder)`; reverse target =
      `email.source_folder`. `from` = `email.folder` (as today). Hints: forward `{ fromUid: email.uid, toUid: email.uid }`; reverse
      `{ fromUid: email.uid, toUid: email.inbox_uid }`. `byAppend` = `to === INBOX && email.source_folder !== INBOX`.
    - `ensureOnce`: when it must move, `byAppend` → `provider.transferByAppend(from, uid, to)`, else `provider.moveMessage(from, uid, to)`. The rest of the
      ensure (locate the target, then the source, delete a leftover, `from === to` only locates) is unchanged.
    - Marker (D9): a forward move with target `inbox` sets `undo_pending_at` = now with `setUndoPending` in its own commit before `ensureMoved` (each try;
      it is idempotent). `clearUndoPending` (rename it `clearMovePending`) runs for `move` actions with a reverse id **or** a forward `inbox` target, in the
      final `applied` and `failed` transactions, as today for reverse rows. A `ready` rescue that expires (D21 of S3) keeps the marker until it is 24 h old (accepted: D9).
    - Location write: `to === email.source_folder` → `{ folder: to, uid, sourceUid: uid, movedAt: null }`; else `{ folder: to, uid, movedAt: now }`; and
      `undoPendingAt: null` for a reverse or a rescue. `markUndone` and the audit rows as today. The audit `data.folder_key` takes the `MoveTarget` key.
    - `actions/repo.ts`: the action view parses `payload.folder` with `z.enum(moveTargets)`, so a digest line reads `move to INBOX` (stage 3 phrase).
  - Test (fake; the Interia COPY path `capabilities: { move: false, uidplus: true }` unless named; fixtures `insertTestEmail` with `folder`, `source_folder`):
    1. Forward move of an `Oferty`-source mail into `AI/Info` → row `folder` `AI/Info`, new uid, `source_folder` `Oferty`, `inbox_uid` unchanged, `moved_at` set;
       `fake.calls` has `moveMessage`, no `transferByAppend`.
    2. Undo of test 1 → the reverse moves it back into `Oferty` (not INBOX): `folder` = `Oferty`, `uid` = `inbox_uid` = the new `Oferty` uid, `moved_at` null,
       `undo_pending_at` null; the original is `undone`.
    3. Rescue: a `Wiadomości-śmieci`-source mail with `\Flagged`, action move `inbox` → `fake.calls` has `transferByAppend`, not `moveMessage`; row `folder` INBOX,
       `source_folder` `Wiadomości-śmieci`, `moved_at` set, `undo_pending_at` null after the commit; the INBOX copy has `\Flagged`.
    4. Undo of the rescue → `moveMessage` back into `Wiadomości-śmieci`; `folder` = `source_folder`; `moved_at` null.
    5. A crash between APPEND and EXPUNGE (`failOn("deleteMessage", new HardError("x"))` once) → the first try retries later; the second claim finds the mail in
       INBOX and in the source, deletes the source, `applied` with `leftover_deleted` true; one INBOX copy.
    6. A crash after the IMAP part (`beforeCommit` throws) → the next claim finds the target only, `applied`, no second `transferByAppend` (`fake.calls`).
    7. During the rescue the row has `undo_pending_at` set: read it in a provider wrapper around `transferByAppend` before it calls the fake (the wrapper
       is awaited; `beforeCommit` is not, `apply.ts` calls `deps.beforeCommit?.()` without `await`, so an async read there races the commit; independent review m5).
    8. A rescue whose mail is gone (deleted from the source) → `failed` `mail_not_found`; `undo_pending_at` null.
    9. The S3 reverse of an INBOX-source mail from `AI/Spam` into INBOX uses `moveMessage` (source INBOX → `byAppend` false); the existing tests pass.
    10. `resolve("inbox")` makes no `ensureFolder` call and no `folder_map` change; `resolve("ai_info")` as today.
    11. A forward payload `{ folder: "INBOX" }` (not a key) → `failed` `bad_payload`.
    12. (`actions-repo.test.ts`) the action view of a `logged` move `inbox` has `folder` `inbox`.
    13. A flag on an `Oferty`-source mail in `Oferty` whose UID changed (the locate finds a new UID) → `uid` and `inbox_uid` both take the new UID; the same
        on a mail in `AI/Info` (source INBOX) → only `uid` changes.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–13 pass and the existing actions tests pass.
  - Out of scope: what the triage plans (stage 11); texts (stage 12).
