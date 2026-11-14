# F103 plan: sentences for other tickets' stage spawns (from the planner's report, 2026-11-14)
- F099 stage 04 and F100 stages 06-07: new log field names go into the kind lists (F103 stage 01).
- F097 `sim*.ts` and F100 `stats-week.ts`: scripts print through `createCliOutput` (F103 stage 02).
- F098, F099, F100, F097: files that F103 has converted are at lint error (old log form).
- After F103 stage 13: `no-console` is an error in `apps/server/src`.
- F095, F099 and F100 stages that edit `deploy/README.md`, and F099 `stage-15-vps-deploy.md`: use `$C run --rm cli ...` instead of `$C run --rm server ...` once F103 stage 17 landed.
- E6 notes name events with dots (`reply.drafted`); event codes allow no dots, so the E6a planner uses `reply_drafted`.
- After F103 stage 17 lands, tell the owner: the next `up` of the shared dev stack recreates the dev `db` and `greenmail` containers (new log driver); volumes keep the data.
- After F103 stage 13 lands, remove the "395 old-form log calls" sentence from spec/build.md TRACK.
- F103 Q5: the E8 Should items (client-errors route, CI security, threat model, key rotation, load test, IMAP IDLE) are in neither F103 nor F114 yet; decide E8b (F114) or a new ticket when F114 is planned.

# F097 refresh: sentence for the F098 stage 10-11 spawn (2026-11-14)
- If F097 stages 03-04 land before F098 stages 10-11: the `/review` texts (`packages/core/src/digest/review.ts`, the picker in `channels/review-taps.ts`, the `/review` help line and menu entry) must move into the texts registry with en and pl. Name this in the F098 stage 10 and 11 spawn text.
