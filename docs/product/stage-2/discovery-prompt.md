# Discovery session prompt (one per epic)

How to use: open a new agent session in this repo and paste one line:
- `Run the next Stage 2 discovery session: docs/product/stage-2/discovery-prompt.md` — the agent takes the first `queued` row of the tracker in `05-execution-plan.md` §3.
- `Run docs/product/stage-2/discovery-prompt.md for epic E04` — one epic out of order.
- `Run the second pass of docs/product/stage-2/discovery-prompt.md for epic E03` — when the row's second-pass trigger has arrived.

Answer the agent's decision list with "go with defaults" or with the changes you want. Discovery runs for all epics first (PD-012); planning with `plan-task` starts when the queue is empty.

An agent that reads this file from a launch line: run the block below. Replace `<E_ID>` with the epic id (for "next", the first `queued` row of `05-execution-plan.md` §3). For a second pass, run the "Second pass" block at the end instead.

---

```text
Run the Stage 2 product discovery session for epic <E_ID> of the email assistant.

## What this session is
The Stage 2 plan is approved (docs/product/stage-2/README.md, decisions in decisions.md). Each epic gets one product discovery session; all of them run before any implementation planning (PD-012). This is that session for <E_ID>. First set its row in docs/product/stage-2/05-execution-plan.md §3 to `in session`. The output is a product decision, not code and not a file-level plan. The implementation plan comes later with the `plan-task` skill; do not run it here.

## Read first, in this order
1. docs/product/stage-2/03-product-frame.md — the thesis, users, principles, metrics M1–M8, non-goals. Every recommendation must serve it.
2. docs/product/stage-2/epics/<E_ID>-*.md — the epic page: outcome, scope, dependencies, open product questions, risks, exit, size.
3. docs/product/stage-2/05-execution-plan.md — the waves, what this epic needs and what depends on it.
4. docs/product/stage-2/decisions.md — decisions already made; never reopen one without a reason.
5. docs/product/stage-2/04-review-result.md — the review findings and the market input (§3, §8, §9).
6. The other epic pages in docs/product/stage-2/epics/ — to find overlaps, gaps and items that belong elsewhere.
7. The current application: docs/capabilities/ if it exists, else docs/architecture.md and docs/product-brief.md; then the code of the modules this epic touches (apps/server/src/modules/, apps/web/src/, packages/core/src/). Check what exists before you call anything new.
8. The planned tickets this epic absorbs: spec/features/planned/ (grep the epic page for F-numbers), and spec/build.md.
9. grep notes/, spec/features/ and docs/known-alerts.md for the epic's topics before you investigate them.
Do not touch spec/features/, tasks/ or spec/build.md: another session may be building there. spec/vision.md is owner-owned: propose text, never edit it.

## Do
1. Validate the epic: is its outcome right for the thesis, is its scope the right size, is anything missing or wrong? Say "keep", "modify" or "split", with the reason.
2. Cross-check against the application: for every in-scope item say what exists today (file or module), what is partly there, what is new. Correct the epic page where it is wrong about the code.
3. Cross-check against the other epics: items that overlap, items that belong to another epic, dependencies the page misses. Propose the move; do not edit the other pages (list the edits for the owner).
4. Research: search the web for how current products (2026) solve this epic's problem and for any standard, API fact or library fact the decisions depend on. Keep queries generic; no secrets, addresses or customer data in queries. Mark every web claim with its source and date; mark vendor claims as marketing.
5. Use your own product judgment: what would an experienced product team do here, and what would they refuse to build.
6. Answer every open product question of the epic page with a recommendation and a default. Add questions the page missed. Batch them in one list so the owner can answer "go with defaults". A question that needs measured numbers (E2 reports, E3 metrics) or a spike on a real provider still gets a default now; mark it "second pass after <trigger>" and say what number or fact would change the default. The last item of the list is always: "Commit the changed files by explicit path [yes]".
7. Size check: confirm or correct the stage and line estimate of the epic page against what you found in the code.
8. Risks: confirm, add or remove, each with a mitigation.

## Write (files, full detail; the next agent has no chat history)
- Update docs/product/stage-2/epics/<E_ID>-*.md: a new section "## Discovery (date)" with the validation verdict, the code cross-check table (item · exists today · new), the cross-epic notes, the research facts with sources, the decided answers, the corrected size and risks. Keep the page under 200 lines; move long detail to docs/product/stage-2/epics/<E_ID>-discovery-notes.md.
- After the owner answers: add rows PD-<next> to docs/product/stage-2/decisions.md (id, date, decision, owner words), and list in the page which planned tickets it absorbs, replaces or drops.
- Set the status in two places, the epic page header and the epic's row in 05-execution-plan.md §3: `ready to plan`, or `decided, second pass after <trigger>` when a question waits for numbers or a spike (fill the "Second pass" column).
- If a design rule changes (for example a new folder the system reads, a new sub-processor, a new auth path): write an ADR draft in docs/decisions/ with the next number, status "proposed".
- If you learned a fact a later agent needs and it is not a decision: notes/YYYY-MM-DD-<topic>.md.
Commit only when the owner's answer includes the commit item: `git add` each changed file by explicit path (docs/product/stage-2/…, docs/decisions/…, notes/…), never `git add -A` or a folder; review `git diff --staged`; one commit "docs(product): <E_ID> discovery". A commit on master auto-pushes. Never stage files of other sessions.

## Reply to the owner (chat, short)
1. First line: the verdict on the epic in one sentence (keep, modify, split, and why).
2. Key ideas: at most five bullets, the things that matter most, with what you recommend.
3. Decisions: a numbered list, each with the recommended default in brackets. "Go with defaults" must be a complete answer.
4. What changed in the files, with paths.
Then wait for the owner. After the answers, write the decision rows, set the status, commit, and end with: what is finished, what is waiting on the owner, and the next launch line (the next `queued` row of 05 §3, or "Discovery queue empty" when none is left).

## Rules
- The product rules in 03-product-frame.md §4 are not negotiable: no send without a tap, LLM proposes and code checks, every action has a reason and an Undo, mail text is untrusted, every action is a channel-neutral API command, no mail content in logs or third-party chats.
- Prefer measured proof over opinion: where E2 or E3 numbers decide a question, say so and keep the question open until they exist.
- Engineering time is abundant and the owner's attention is scarce: decide what you can, choose the proper design over the patch, and keep to the asked outcome.
- Plain technical English, short sentences, active voice, no filler.
```

---

## Second pass (one question set that waited for numbers or a spike)

```text
Run the Stage 2 discovery second pass for epic <E_ID> of the email assistant.

1. Read docs/product/stage-2/epics/<E_ID>-*.md (its "Discovery" section and the questions marked "second pass after <trigger>"), its row in docs/product/stage-2/05-execution-plan.md §3, and decisions.md.
2. Find the trigger result: the E2 or E3 report, the eval run, or the spike result (spec/features/done/, notes/, the report files the epic page names). If it does not exist yet, stop and tell the owner which result is missing.
3. For each waiting question: compare the default with the result. Keep or change the default, with the number that decides it.
4. Reply to the owner: first line the verdict; then a numbered decision list with defaults; the last item "Commit the changed files by explicit path [yes]".
5. After the answers: add PD-<next> rows, update the page's "Discovery" section with a dated "Second pass" paragraph, set the page header and the 05 §3 row to `ready to plan`, and commit by explicit path as in the main prompt.
Plain technical English, short sentences, active voice, no filler.
```
