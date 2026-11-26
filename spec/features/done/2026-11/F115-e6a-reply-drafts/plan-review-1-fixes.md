# F115 · Fixes for plan-review-1

- B1: D14; stage 04 (envelope, limits, `self` filter over `to ∪ cc`; tests 4, 5, 7).
- B2: D9; `interfaces.md` `draftCopyKey`; stage 08 (text, Subject, To, Cc, attachments; text null = changed; test 3).
- G1: `closeSend` with `claimed` and `draft_missing` (`interfaces.md`, stage 05).
- G2, N5: stage 08 needs 05; plan lanes.
- G3: payload `folder`; mail `newerMailInThread` (`interfaces.md`, stages 07, 09).
- G4: stage 07 test 2 (GreenMail copy with `In-Reply-To`).
- G5: stage 09 sweep `notify` true for `approved`; questions #7.
- G6: stage 12 dedup key `approval:<sendId>:r<n>`.
- G7: `requestReply` `open`; stage 07 step 4 (redraft of a closed send), stage 13 result texts.
- G8: stage 02 Arguments.
- G9: stage 11 org card read-only; questions #20.
- G10: flag `draft_copy_check`; probe P1; questions #19.
- G11: stage 01 phone rule and test 12.
- G12: D16; stage 12 step 3; stage 15 step 3; questions #1.
- G13: stage 16 metric pattern.
- G14: stage 07 step 4 re-check; stage 12 count.
- N1: rejected. A changed old copy that stays in Drafts is the user's own text; the stage 09 answered check before any send stops a double reply when Sent sync or `\Answered` works, and stage 12 warns when Sent is not visible.
- N2: D7 (automatic mail does not close). N3: sweep `suspicious`. N4: report names. N6: stage 07 10-min timeout. N7: `closeSend` edits cards. N8: CLI in stage 08. N9: derived `gaps`. N10: no change.
