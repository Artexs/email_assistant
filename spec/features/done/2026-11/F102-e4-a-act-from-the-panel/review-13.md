# F102 stage 13 review (Opus 5.5, PASS 55973ed5)

Model: Opus 5.5, because the stage has new Polish text and edits a draft that goes to people. No BLOCKING.

Fixed in one Sonnet continue (no re-review): N1 (the 5 s draft poll closed an open edit dialog and lost the typed text: the poll and the `currentId` follow now stop while the dialog is open), TG1 (focus after "Skip" of the reject reason), TG2 (where focus lands after a 409 `closed` and after "Open the new version"), and N3 (`appr_closed_draft_gone` en "The text of this draft is no longer stored.", pl "Treść tego szkicu nie jest już zapisana.").

Verified: Edit shows only for owner + write + `waiting` + delegation or clarification (a reminder, a held send and a member have no Edit; the server refuses through `requireOwner`); the form uses the server's own `cleanUserText`, `EDIT_SUBJECT_MAX` and `EDIT_BODY_MAX` and sends the cleaned text; a saved edit needs a new Approve (Approve stays off until `draftReady`); every closed state and edit code has a true text; the Polish is proper; the `SEND_SCOPE=self` e2e seed is test-only; no server-only code in the web bundle (csp 19 pages); the poll is bounded (only while the open item is `waiting` and not `draftReady`, paused in a hidden tab, a 401 still redirects to login); the axe `include` with the reason select open is the known Radix behaviour (full page checked with the select closed and after the answer); the worker's mutation `mut-e2e-focus-after-save` was killed for the wrong reason in a solo run (the full spec kills it for the right reason).

Notes:
- N7 (minor): a field error stays after the user fixes the field (`problem` cleared only on submit); the server cannot give those errors because the form blocks the values first.
- Key count: 24 new keys per file (21 `appr_edit*` plus 3 `appr_closed_*`), not 24 + 3.
