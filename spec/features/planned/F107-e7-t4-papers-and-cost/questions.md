# F107 questions (defaults taken; owner to confirm)

None blocks the build. Each default is in `plan.md` or a stage file. The coordinator copies the `[important]` items to `docs/owner-decisions.md`.

1. **Q1 [important: privacy] Do the drafts name a person or a company?** Default: no. Placeholders `<provider name>`, `<address>`, `<contact>` only, because the repository is public (plan P3; the open question of `tasks/planned/s6e-papers-cost.md`).
2. **Q2 [important: user-visible] Polish wording of the draft line.** Default: "WERSJA ROBOCZA, nie jest poradą prawną. Ta usługa działa na prywatnym serwerze wyłącznie dla jej właściciela." (plan P1). The English line is P21 word for word.
3. **Q3 [important: privacy] Region of the Backblaze B2 bucket.** Not in any repo file. Default: the papers say `<B2 region>` until the owner states it (owner step U3; then a small text change and a version bump).
4. **Q4 [minor] Language of the internal papers** (DPIA, records of processing, breach procedure, claims list). Default: English only; the in-app pages are Polish and English.
5. **Q5 [important: privacy] Where the breach register lives.** Default: outside the public repository; the procedure names `<breach register location>`.
6. **Q6 [minor] Two text changes on one day.** Default: `TERMS_VERSION` gets `-2`, `-3` after the date (plan D5).
7. **Q7 [important: user-visible] A small text fix (a typo) also asks every member to accept again.** Default: yes, as master plan D18 says ("changes with every text change"); the text guard enforces it.
8. **Q8 [important: money] Hosting cost in the cost model.** Default: the Hetzner CX23 reference of PD-059 (€5.99 ÷ 20 mailboxes), because the cost model is for a sellable product; the home VPS cost shows as `<home VPS cost>` (master plan D20 as changed). Conflict resolved: PD-059 (2026-11-13) is newer than D20 (2026-11-12).
9. **Q9 [important: user-visible] Target time for the processor's breach notice to the controller.** Default: "without undue delay, target 24 hours after awareness" (stage 05). GDPR sets no number for the processor; 72 hours is the controller's limit.
