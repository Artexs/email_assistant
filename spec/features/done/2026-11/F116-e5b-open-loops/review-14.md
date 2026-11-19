# F116 stage 14 review (Opus 5.5, FAIL 70211178) and checkpoint C2

Model: Opus 5.5, because the stage is [risky] (sending to people, roles).

BLOCKING (repair):
- B1 (proven by reproduction): after a DSR erase of the delegate, a `delegated` loop writes its follow-up to a person who is not the counterpart: `follow-up-draft.ts:60` `loop.counterpart ?? loop.to_addresses[0]`; the address map sets `counterpart` to null and `to_addresses` to the people left; the next Draft tap planned `to: [client]`. Fix: a `delegated` loop with no `counterpart` gives `not_allowed` and no row; remove the `?? to_addresses[0]` fallback; test where `counterpart` is not `to_addresses[0]`.

TEST GAPS: TG1 (mutation `loop.counterpart ?? to_addresses[0]` -> `to_addresses[0]` survives: fix with B1); TG2 (the lock on the Sent state row in `reopenLoop` has no test: a two-connection race Reopen against `setSentSync(off)` with `onSentOff`, app role, table owner and mixed: no open loop while tracking is off).

Coordinator decisions (owner decisions log): N1 (Sent tracking off clears the follow-up copies: the `quote`, To and Cc of loop-anchored `actions.payload` and `outbox.view`/`outbox.text`, in `onSentOff`, with tests and a mutation); N2 (the loop's counterpart and recipients are excluded from the own-address set from Sent rows).

Fixed in the repair too: N4 (the stage text key shape `<loop id>:create_draft|send:follow_up:<n>:<k>` as `sent-mail.md` rule 21), N5 (the worker note: `loop_id` in the `loop_command` line is `input.loopId`, not read from the database; the logger drops non-UUID values).

Carry-over: N3 (stage 15 or a later migration: `sentFromAddressesOf` reads the mailbox's Sent rows with GROUP BY on every `matchReplies` run and every `isOpen`, under the loop lock: no index covers `(mailbox_id, from_address)`: cache per run or add the index); N6 (a `failed` send with an unknown outcome does not count as waiting: a new tap can plan a second mail to the same people; each card needs the owner's approval: accepted default).

Checkpoint C2 (reviewer's paragraph): holds: the loop row is the only source of recipients; one lock discipline (settings share, loop, sends; the Sent state row before loops); each close expires the waiting follow-up in the same transaction; exactly-one rules have race tests on real connections; logs carry ids and codes only. Risky: the edges where one stage's delete or scrub rule meets another stage's copy (B1, N1); the own-address rule trades false closes for missed closes (N2); guard pairs (command check plus conditional update) are often proven by one side only. Before `open_loops` is turned on, the owner looks at: B1 fixed; N1 and N2 decisions (done as above); the text for a Reopen refusal on a loop the list shows as closed (stages 19-21); the Gemini extractor-schema check that `sent-mail.md` rule 19 names.
