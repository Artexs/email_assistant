# F102 stage 17: delegates page (notes for stage 18 and 19)

- Shared header: `components/delegation/DelegationTabs.tsx` (`current` = `delegations` or `delegates`). Stage 18 uses it on `/delegations`.
  The tab links are plain `<a>`. `/delegations` answers 404 until stage 18 lands.
- Shell: `NavKey` has `delegations`. The delegates page passes `active="delegations"`, so stage 18 only has to add the nav item
  (the highlight follows). No nav item for `/delegates` (decision D11).
- Limits: `DELEGATE_NAME_MAX`, `DELEGATE_TAGS_MAX`, `DELEGATE_TAG_MAX` and `ADDRESS_PATTERN` now come from `@ea/core/web`
  (`packages/core/src/web/delegation.ts`). The service and the form read the same values. The Polish text `dlg_tags_error` fills
  10 and 30 (plural form "many": 10 tagów, 30 znaków); a unit test pins the filled text. A limit change needs a new Polish text.
- Focus rules of the page (all in e2e `delegates.spec.ts`): add success -> Name; add or save error -> the field named by the text;
  Edit dialog close -> its Edit button; turn-off question close -> its switch; a delegate that is gone -> the status line.
  The submit button is not disabled during the request (guard: `singleFlight`). No test shows that a disabled button would lose
  the focus (mutation `disabled={busy}` survives: the request ends in milliseconds), so that comment is a design choice, not proven.
- Chromium keeps the focus on a switch when the list reloads and its row moves (active first, then name): a refocus effect was
  removed because its mutation survived (`/tmp/f102-s17/mut-e1-no-refocus.log`). Other browsers are not tested.
- e2e seed: one `E2E Delegates <project>` organization per project (owner, member, delegate Anna Nowak with tag `finance`, flag
  `delegation_pages`, no mailbox) and the shared paused (suspended) organization got the flag and the same delegate.
- Not covered by a browser test: 400 `mailbox_address` (the seed organization has no mailbox; the unit test maps the answer).
