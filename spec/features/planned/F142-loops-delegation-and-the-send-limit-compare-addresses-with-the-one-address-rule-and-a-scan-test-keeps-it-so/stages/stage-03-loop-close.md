# F142 stage 03 — loop close and the reply read use the one rule [risky]

Part of [`../plan.md`](../plan.md). `[risky]`: this code decides whether a loop closes or the user is chased. Review: `claude-opus-5-5` before the land.

Needs stage 01: `normalizeAddress`, `addressLowerForms` (`@ea/core`), `normalizedAddress` (`apps/server/src/platform/db`).
May run next to 02 and 04: it changes only `apps/server/src/modules/loops/reply-read.ts`, `loops/match.ts`, `packages/core/src/loops/replies.ts`, their tests and `docs/capabilities/open-loops.md`. Stage 04 owns the other loops files.

## Step 1 — the close rules (one `[risky]` step)

- **Goal:** a reply closes a loop when its From is a loop recipient by the rule, and an own address or alias never closes it, by the same rule.
- **Files and interfaces:**
  - `packages/core/src/loops/replies.ts`: the private `lower` helper goes; every address compare in `replyMatch` and in the no-reply sender check of the automatic-mail test uses `normalizeAddress`. The `Auto-Submitted` and `Precedence` header folds and the subject normalizer are not addresses: they keep their fold with the marker `// not an address: <reason>` (plan D9). Signatures unchanged.
  - `loops/match.ts`: `ownAddressSetsOf` returns the rule form of each mailbox address; the aliases read groups and orders by `normalizedAddress("from_address")` of the Sent rows (D8); `ownAddressesFor` builds the people set with `normalizeAddress`. `OwnAddressSets` keeps its shape; its comment says "rule form" instead of "lower case".
  - `loops/reply-read.ts` (`replyCandidates`): recipients and own addresses go through `normalizeAddress`. The read by recipient keeps the indexed column: `e.from_address_lower` in the union of `addressLowerForms(r)` over the recipients (D7). The own-address exclusion is `normalizedAddress("e.from_address") not in own` (D8). The thread read is unchanged. `decideReply` stays the final judge.
- **Decisions:** D7, D8. The superset may grow; `replyMatch` decides. No change to the 200-row limit, the window, the junk or spam filters.
- **Test** (core unit in `packages/core/src/loops/replies.test.ts`; integration in the loops reply tests of `apps/server/test/integration/`; fixed clock, wait from `2026-11-02T09:00:00Z`, subject `Budget 2027`, replies `Re: Budget 2027` on `2026-11-03T09:00:00Z` in another thread unless said):
  - 03-T1 guard (unit): `replyMatch` with `toAddresses: ["İlker@Example.com"]`, From `ilker@example.com` → `"subject"`; with `toAddresses: ["νίκος@example.gr"]`, From `νίκοσ@example.gr` → `"subject"`. The base code gives `null` for both.
  - 03-T2 guard (int): loop `to_addresses = ["ΝΊΚΟΣ@example.gr"]`; an `emails` row from `νίκος@example.gr` (its `from_address_lower` keeps `ς`) → the loop closes with `subject`. Remove `addressLowerForms` from the read (plain rule forms only): the loop stays open.
  - 03-T3 guard (int): loop `to_addresses = ["νίκος@example.gr"]`, counterpart `νίκος@example.gr`; a reply from `ΝΊΚΟΣ@example.gr` (the database lowers it to `νίκοσ`) → closes. The base code leaves it open.
  - 03-T4 guard (int): mailbox address `İlker@Example.com`; a mail in the loop thread from `ilker@example.com` → no close (own). A Sent row from `ΝΊΚΟΣ@example.gr`; a mail in the thread from `νίκος@example.gr` → no close (alias). The base code closes on both.
  - 03-T5 guard (int): a Sent row from `ΝΊΚΟΣ@example.gr`, and the loop is to `νίκος@example.gr` → a reply from `νίκος@example.gr` closes (a loop person is not an alias). Build the people set of `ownAddressesFor` with `toLowerCase` instead: the alias stays own and the test fails.
  - 03-T6 pin (int): org B has a mail from `νίκος@example.gr` with the subject → the loop of org A stays open.
  - 03-T7 pin (unit): the automatic-mail test is true for From ` NO-REPLY@Example.com`.
- **Check:** `bun test packages/core/src/loops` and the changed integration files with `bun run test:int:ci -- <files>` while you work.
- **Done when:** 03-T1 to 03-T7 pass; each guard test fails as said.

## Step 2 — page

`docs/capabilities/open-loops.md` § close rules: one sentence that recipients, own addresses and aliases compare by the one address rule, and that a From with padding or a combining dot outside the thread is not found (plan D7).

## Out of scope

Loop creation, the delegate button, the chaser test-sender filter (stage 04). A new index or column.

## Done when

Steps 1–2 done, then the Proof of `plan.md` with `NN=03` prints `PROOF_OK`. The result lists each guard removal and its failing test.
