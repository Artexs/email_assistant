---
opened: 2026-11-13
---

# F102 · E4-A Act from the panel

## Outcome

An owner approves, rejects and edits waiting drafts in the web panel, and manages delegates and delegations there, not only in Telegram. An edit is a new version that needs a new tap, and the Telegram cards follow each panel action. Every user action is a typed API command in one OpenAPI file, which the later phone, reply-draft and open-loop work build on. Source: row 8 of `docs/product/stage-2/05-execution-plan.md` §2.1 and the E04 epic page.

## Scope

- The OpenAPI file of the `/api` routes and a check that every route is described.
- The approvals page: list, the full draft and the mail it answers, approve, reject with an optional reason, edit (text or another delegate), a nav badge.
- Telegram approval cards: an "Open in panel" line, and an edit of the card after a decision elsewhere.
- The delegates page and the delegations page: remind now, done, cancel.
- Accessibility checks (axe) on every panel page; a keyboard test for approvals.

## Out of scope

- E4-B: why lines, history check, trust report, quiet hours, unsubscribe (the E4-B ticket, F110).
- Edits of a draft in the mail client and reply drafts (E6a, F115); manual delegation and open-loop tabs (E5b, F116).

## Acceptance

- `GET /api/openapi.json` lists every non-hidden `/api` route; a unit test fails for an undescribed route.
- A panel edit makes a new version; the old version cannot be approved from the panel or from Telegram.
- After a panel approval, each owner's sent Telegram card shows the result line and no buttons (not a reminder-set card; a card in sending at that moment keeps its buttons, and a tap answers by the current state).
- With the flag on, an owner manages delegates and reminds, cancels or closes delegations; with it off, their API routes answer 404 and the pages show the flag-off text.
- Every e2e spec has zero axe violations; the approvals keyboard test passes.
- The VPS runs the change with both flags on for the pilot: [plan.md](plan.md) § Done when (5 items).

## Slices

20 stages, one worker job each: [plan.md](plan.md) § Stages and § How to run. Stage 06 is the only migration; stages 01 and 07 the only `bun.lock` changes. Stage 20 is the VPS deploy by the coordinator. Owner step U1 (phone test) does not stop the build.

## Sequenced

- Plan after: F101 (Panel to Astro 7; its stages exist).
- Build after: F095 and F098 (in `done/`). F101 in `done/` before stage 07 and the page stages 12, 13, 17, 18.
- Gate: —.

## Notes

Absorbs dropped F039 (card edit in place) and the panel half of dropped F075. Defaults: [questions.md](questions.md).
