---
opened: 2026-11-13
---

# F118 · E9b Phone channel (PWA, push, Telegram detail)

## Outcome

A user can install the web panel on the phone and get Web Push notices that hold only a kind, a count and an id; a tap opens the item in the panel. Each user picks per notice group Telegram, push or both. Telegram has a per-user detail level: `full` (today) or `minimal` (counts and panel links, no buttons); new links default to `minimal`, and the organization owner can lock `minimal`. Source row: `docs/product/stage-2/05-execution-plan.md` §2.1 #24; epic `docs/product/stage-2/epics/E09-reach.md`.

## Scope

- Web Push sender (own RFC 8291 and RFC 8292 code), VAPID keys, push subscriptions bound to a session, device list.
- PWA: manifest, app-shell service worker, install help (Android, iOS text).
- Routing per user and notice group (PD-094); push-only members get notices.
- Telegram `minimal` render for every kind, the detail setting, the link step, the org lock (PD-092).
- Flags `web_push` and `telegram_minimal`; papers and `TERMS_VERSION`; ADR 0032 accepted.

## Out of scope

- E9a Mailbox OAuth (F117). A public panel (ADR 0017). iOS tests. Push for the digest and the report kinds (they keep PD-033). A mail-detail page.

## Acceptance

- The panel installs on the owner's Android phone, and a planted urgent mail gives a push whose tap opens the panel (owner checkpoint A and B).
- A push payload holds only `v`, `id`, `kind`, `count`, `itemId` and `lang` (unit test on every push kind).
- A user in `minimal` mode gets no sender, subject, summary, draft, address or name, and no button, for every notice kind (canary test over all kinds).
- Sign-out of a session removes the push devices of that session (integration test).
- A member with no Telegram link and one push device gets urgent and approval notices by push (integration test).
- Full list: `plan.md` § Done when (7 checks).

## Slices

- 13 worker stages in order (`plan.md` § Stages); no stage runs in parallel with another of this ticket.
- Stages 02 and 10 add a migration: no other migration in the repo at the same time.
- Owner checkpoint A after stage 05 (a real push on the owner's phone), B after stage 13 (pilot switch-on). How to run: `plan.md` § How to run.

## Sequenced

- Plan after: none.
- Build after: F102 (E4-A) and F110 (E4-B) in `done/`; F088 (notices as facts) is done.
- Gate: checkpoint A (owner, real phone) before stage 06.

## Notes

Source row: §2.1 #24. ADR 0032 (proposed → accepted in stage 13). Absorbs the Telegram half of F075. Decisions: PD-092, PD-093, PD-094, PD-095.
