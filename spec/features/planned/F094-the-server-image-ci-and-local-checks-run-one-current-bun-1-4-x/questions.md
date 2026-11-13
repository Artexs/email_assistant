# F094 · open questions (small; defaults taken, owner to confirm)

None of these blocks the stages. Each default is a decision in `plan.md`.

## Q1 May the coordinator push the stage 1 job branch to `task/f094-bun-pin` so that CI runs before the land?

- **Fact:** CI runs on `master` and `task/**` only; Limen job branches (`limen/…`) get no CI (`plan.md` F11). The pin change moves the runtime of CI, the image and every job's proof at once.
- **Options:** (a) push the job branch to `task/f094-bun-pin` (a normal push of a new branch, never force), wait for green `ci`, `e2e` and `image`, land, delete the remote branch; (b) land first and watch the `master` run; a red run is reverted with `git revert` the same day.
- **Default:** (a), decision D7. It keeps `master` green; the cost is one extra CI run (about 5 minutes).

## Q2 Build after F086 lands, or next to it?

- **Fact:** `07-foundation-plan.md` §2 says "F086 next and alone". A pin change moves the Bun of every job's proof, so a stage of another ticket that started before the land proves on 1.3.14 and merges onto 1.4.4.
- **Default:** build after F086 is in `done/`, decision D9 (`ticket.md` § Sequenced). The build is one worker job plus the deploy, so the wait is short.

## Q3 Add one STARTTLS test that a trusted certificate for another name is refused for an IP host?

- **Fact:** on Bun 1.3.14 a STARTTLS upgrade to 127.0.0.1 accepted a certificate issued for `localhost` (`plan.md` F4). The old tests prove only that a correct certificate passes and an untrusted one fails.
- **Default:** yes, decision D4. It is the proof of the ticket line "STARTTLS to a mail host given as an IP address verifies the certificate", and it turns red if a later pin brings the quirk back. It changes only the test file.

## Q4 Exact `1.4.4`, not the floating tag `1.4`?

- **Default:** exact `1.4.4`, decision D1. The latest stable release and the PC's Bun; the `image` job compares exact text.
