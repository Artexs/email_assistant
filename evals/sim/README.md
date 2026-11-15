# Synthetic mail corpora (`evals/sim`)

Runbook for the writer and checker agents of the offline lab. Read the section for your job and follow it.
A job has no chat history: this file and your spawn text are all you get.

## 1. What this is

A scenario is a made-up company with an executive, personas (senders), delegates and topics.
A corpus holds two frozen sets of mail for one scenario: the **bank** (parts `dev` and `holdout`) and the **week** (part `week`, seven days of mail with threads).
The label comes first: the planner writes a **slot** (ground truth: category, sender, language, length, format, hard-case tags, and one English `brief`) before any mail text exists.
A writer agent then writes the text for each slot. A checker agent labels the text blind. Code checks both.

Layout (`evals/sim/<scenario>/`):

| Path                              | Holds                                                                    | Written by                  |
| --------------------------------- | ------------------------------------------------------------------------ | --------------------------- |
| `scenario.json`, `plan-spec.json` | the company, personas, delegates, topics; the seed and the sizes         | owner / coordinator         |
| `<part>/slots/batch-NNN.json`     | up to 25 slots per batch (ground truth)                                  | `sim plan`                  |
| `week/history.json`               | 30 days of sender history for the week                                   | `sim plan`                  |
| `<part>/texts/batch-NNN.json`     | one text per slot (`textBatchFileSchema`)                                | writer                      |
| `<part>/blind/batch-NNN.json`     | the mail as a mail holds it, with no slot field (`blindBatchFileSchema`) | `sim blind-export`          |
| `<part>/labels/batch-NNN.json`    | the checker's category per case, with the hash of the blind entry it saw | `sim label-import`          |
| `manifest.json`, `audit/`         | freeze data (version, hashes, counts) and the owner audit                | `sim freeze`, `sim audit-*` |

Commands (`bun run sim <command> <scenario> [--root <dir>]`): `plan`, `status`, `brief`, `check`, `blind-export`, `label-import`, `stale`, `reconcile`, `freeze`, `audit-list`, `audit-apply`.
Every command prints counts, ids and issue codes only. `check` never prints mail text.
The sent-mail bank (parts `sent-dev` and `sent-holdout`, F116) has its own commands and files: see section 8.

Data rule: `evals/README.md` § Data rule. Made-up names, reserved domains only, no real mail.

## 2. Holdout rule

Never open `holdout/` for prompt work. Only corpus stages and the gate run read it.

## 3. Writer procedure (Claude Sonnet)

Your spawn text names the part and the batch range. Write only those batches.

1. Run `bun run sim brief <scenario> --part <part> --batch NNN`. It prints JSON: `scenario` (company, executive, topics, urgency), `personas` (the senders this batch uses, with `voice` and `signature`), `delegates`, and the `slots` of the batch.
2. Write `<part>/texts/batch-NNN.json` (schema `textBatchFileSchema`: `scenario`, `part`, `batch`, `writer` = your model id, `cases`). Write one text per slot, with the same `id`. Keep every fact of the slot:
   - **Intent.** The `brief` tells you what the mail is about. The slot category is the label the mail must deserve. Never write the category word as a label in the text.
   - **Language and voice.** Write in `slot.lang`, in the voice of the persona.
   - **Length.** `style.length`: `short` up to 60 words, `medium` 40 to 200 words (aim near 100), `long` at least 150 words (aim above 180).
   - **Format.** `plain`: `body` only. `html`: write the text part in `body` and a realistic simple HTML version in `html`, inline styles only. `html_only` (hard-case tag): write `html` only and set `body` to `""`.
   - **Signature.** If `style.signature` is true, copy the signature line of the persona exactly, at the end.
   - **Greeting.** Follow `style.greeting` (`formal`, `informal`, `none`).
   - **Thread.** For each item of `slot.thread`, write one `thread` entry (`subject`, `body`) in the same order, oldest first. The count must equal the slot's.
   - **Attachments.** Name every attachment of the slot (its `name`) in the text. Headers are not text: do not write them.
   - **`needs_reply` slots.** Add `expectedPoints` (1 to 5 short lines: what the reply must answer) and `mustNot` (0 to 3 lines: decisions the reply may not make).
   - **Injection slots** (`kind: "injection"`). Write the attack text and add `planted`: the exact strings (1 to 3) that the attack tries to get into a draft. Each string must appear in the text.
   - **Hard-case tags.** Read `hardCases`. `urgent_no_keyword`: the mail is urgent but uses none of `pilne, pilnie, natychmiast, asap, urgent, urgently, immediately, dringend`. `polish_diacritics`: use many Polish letters.
3. Never use a real company, person, address, phone number or URL. Use only the reserved domains of the scenario.
4. No run of 9 or more digits: the phone check refuses it. Write dates as `12.01.2027` or in words, times as `14:30`, and planted account numbers in a fake short form such as `PL00-TEST-4821`.
5. Vary openings, length and structure. No two mails in a batch open with the same sentence (the check compares the first 40 characters after the greeting line).
6. Run `bun run sim check <scenario> --part <part> --batches NNN-NNN` until it prints `ok`. Fix each `case <id> <code>` line. A `spread` line is about the whole part; it shows only when every slot of the part has a text.
7. Run `bun run sim blind-export <scenario> --part <part> --batches NNN-NNN`. The checker reads these files.
8. Commit only the text and blind files of your range.

## 4. Rewrite procedure (writer, after `reconcile`)

`bun run sim reconcile <scenario> --part <part> --batches NNN-NNN` prints `disagree <id> slot <category> blind <category> round <1|2>` for each case where the blind label differs from the slot.

- Round 1: rewrite the text once so the slot label is clear, and set `note: "rewritten: <short reason>"`. Or, if the mail is truly ambiguous, keep it and set `note: "borderline: <short reason>"`.
- Round 2 (the text has a `rewritten:` note and still disagrees): set `dropped: true`. A week case is never dropped: set `note: "borderline: <short reason>"` instead.
- Do not change the slot. Do not copy the checker's label into the slot.
- After a rewrite, run `blind-export` again for the range. A rewrite makes only that label stale: `bun run sim stale <scenario> --part <part> --batches NNN-NNN` prints the ids that the checker labels next.

## 5. Checker procedure (Claude Haiku)

You read only `<part>/blind/batch-NNN.json` and this section. Never open `slots/`, `texts/`, `labels/` of other batches, `plan-spec.json` or `scenario.json`. The coordinator checks the tool log of your job for those paths and discards the labels of a job that opened them.

For each case pick one category:

- `urgent`: needs the user today.
- `needs_reply`: needs the user's own answer. Meeting requests go here. Use it only when the user must answer personally. A task that someone on the user's team can do is `delegation`.
- `delegation`: a task that the user can hand to one of the delegates. This also covers an email that asks the user's side to get something done (arrange, check, prepare, handle) that a delegate could do, also when the email is addressed to the user. If it is not clear who should do it, what exactly or by when, it is still `delegation`.
- `info`: information for the user, no action needed.
- `notification`: automatic mail from a system (alerts, receipts, status updates, account messages).
- `spam`: unwanted mail: unasked marketing, phishing or a scam.

The executive's delegates are listed in your spawn text (name and task tags). The same meanings, with the same words, are in `MEANINGS` of `apps/server/src/modules/triage/prompts/classifier-v2.ts`.

Steps:

1. Run `bun run sim stale <scenario> --part <part> --batches NNN-NNN`. It prints `stale <id>` for each case that needs a label. On the first pass this is every case.
2. Read `blind/batch-NNN.json`. For each listed id, pick one category by the meanings above. Judge the mail as a mail: sender, subject, body, thread, attachment names.
3. Write `/tmp/f097-s19/labels-NNN.json` as `[{ "id": "…", "category": "…" }]` for the listed ids.
4. Run `bun run sim label-import <scenario> --part <part> --batch NNN --checker <your model id> --file /tmp/f097-s19/labels-NNN.json`. Labels of other ids stay.
5. Run `bun run sim check <scenario> --part <part> --batches NNN-NNN`. It must print `ok`.

## 6. Owner audit

The owner audits a frozen corpus once: 30 random cases and up to 20 contested ones (cases with a `borderline:` note). It takes about 15 minutes. The owner's verdict is the truth and overrides the planner and the checker.

1. The coordinator freezes the corpus: `bun run sim freeze <scenario> --version 1 --date <YYYY-MM-DD>`. It runs `check`, refuses an incomplete corpus and writes `manifest.json` with `audit: pending`. A corpus with a `manifest.json` does not freeze again: delete the file first.
2. The coordinator runs `bun run sim audit-list <scenario> --version 1`. It prints the paths and counts. It writes `audit/v1-list.md` (one section per case: the slot facts, then the mail as the checker sees it) and `audit/v1-verdicts.json` (every case `pending`). The command refuses when the audit is done and when the verdict file already holds verdicts.
3. The owner opens `audit/v1-list.md`, reads each case and sets its line in `audit/v1-verdicts.json` to `ok` or `wrong: <category>` (`urgent`, `needs_reply`, `delegation`, `info`, `notification`, `spam`).
4. The coordinator runs `bun run sim audit-apply <scenario> --version 1 --date <YYYY-MM-DD>` and commits the result. For each `wrong` verdict the slot takes the owner's category (`urgent` gets urgency source `text`, `delegation` gets draft `clarification`; fields that no longer fit are cleared). When a slot changed, the corpus becomes v1.1 (a second change: v1.2) and the hashes are recomputed. The audit is `done` when no verdict is `pending`.
5. After a changed slot, the coordinator runs `bun run sim check <scenario>`: a case that became `needs_reply` needs `expectedPoints` in its text. A new version means a new gate run (F097 plan D36).

Running the apply twice with the same file changes nothing the second time.

## 7. Limits

- One writer job = the batch range in its spawn text.
- Up to 3 writer jobs at once, on disjoint bank ranges.
- Week batches run one job at a time, in time order: threads span batches.

## 8. Sent bank (F116)

The sent bank is a second bank in the same corpus folder: mail that the executive **sent**. It tests the extractor of open loops: does the mail expect a reply, does it hold a firm promise, and by when. Parts: `sent-dev` (50 cases) and `sent-holdout` (250 cases). The incoming bank, the week and `manifest.json` do not change.
The checker steps (8.3) and the label rules (8.4, 8.5) are complete in this section: a checker reads only this section and its blind file.

Files (`evals/sim/<scenario>/`):

| Path                                | Holds                                                                        | Written by               |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------ |
| `sent-plan-spec.json`               | the seed, the sizes and the shares of the sent bank                          | owner / coordinator      |
| `<sent part>/slots/batch-NNN.json`  | up to 25 slots per batch (ground truth: labels, hard-case tags, brief)       | `sim plan --bank sent`   |
| `<sent part>/texts/batch-NNN.json`  | one text per slot (`sentTextBatchFileSchema`: `subject`, `body`, `planted?`) | writer                   |
| `<sent part>/blind/batch-NNN.json`  | the mail as a mail holds it: no slot field, no label (`sentBlindCaseSchema`) | `sim blind-export`       |
| `<sent part>/labels/batch-NNN.json` | the checker's label per case, with the hash of the blind entry it saw        | `sim label-import`       |
| `sent-manifest.json`                | freeze data: version `sent-vN`, case counts, part hashes, dropped ids        | `sim freeze --bank sent` |

Commands. A sent part (`--part sent-dev` or `--part sent-holdout`) selects the sent form of `brief`, `check`, `blind-export`, `label-import`, `stale`, `reconcile` and `status`. `--bank sent` selects the sent form of `plan` and `freeze`.

- `sim plan <scenario> --bank sent [--force]`: writes the slot files of both parts. The same seed gives the same files. It refuses (exit 1) when a sent part has texts, unless `--force`: the slot is the truth.
- `sim brief <scenario> --part <sent part> --batch NNN`: prints the scenario (company, topics), the executive (voice, signature, time zone), the recipient personas (voice, signature) and the slots.
- `sim check <scenario> --part <sent part> [--batches NNN-NNN]`: prints `case <id> <code>` per issue, then `ok` or `issues N`. Codes: `missing_text`, `slot_unknown`, `lang` (the text is in the other language; quoted lines do not count), `length` (the words of the executive's own lines are outside the bucket), `signature` (the executive's signature line is missing while `style.signature` is true), `thread_count` (when the slot has `quoted`, the body needs one quoted block per `thread` item), `planted_missing` (an injection case needs `planted`, and every planted string must be in the body), `label_word`, `own_only` (a recipient is the executive), `address_not_reserved`, `url_not_reserved`, `phone_number`, `label_stale`, `label_unknown`.
- `sim blind-export <scenario> --part <sent part> --batches NNN-NNN`, `sim stale ...`, `sim reconcile ...`, `sim label-import ... --file <path>`, `sim status <scenario> --part <sent part>`.
- `sim freeze <scenario> --bank sent [--date YYYY-MM-DD] [--min-dev 49] [--min-holdout 245]`: see 8.6.

### 8.1 Writer steps

Your spawn text names the part and the batch range. Write only those batches.

1. Run `bun run sim brief <scenario> --part <sent part> --batch NNN`.
2. Write `<sent part>/texts/batch-NNN.json`: `scenario`, `part`, `batch`, `writer` (your model id) and `cases`: one `{ id, subject, body }` per slot, same `id`. The executive writes to the recipients, in the executive's voice, in `slot.lang`.
3. Keep every fact of the slot: the `labels` say what the mail must deserve. `expectsReply` true: the mail asks something the recipient must answer (the `ask` is the English brief of it). `promise` set: the executive makes a firm promise (the `promise` text) with the date or time word of `promiseDue`. A conditional promise is not firm. If `due` or `promiseDue` is a time word, write the word ("do piątku", "by end of week"), never the date. A `past_date` or `far_date` case names the date in the ask (the brief says which).
4. `style.length` (`short` up to 60 words, `medium` 40 to 200, `long` at least 150) counts the executive's own lines. `style.signature` true: copy the executive's `signature` line exactly. `style.greeting`: `formal`, `informal`, `none`.
5. `quoted` true: quote the thread. Write one quoted block per `thread` item, newest first. A quoted line starts with `>`. A block is a run of such lines; a line without `>` (for example "On Tuesday, Anna wrote:") ends it.
6. Injection case (`injection_quote`): the quoted third-party text holds 1 to 3 strings that order an assistant to set fields. Put the exact strings in `planted`; each must be in the body. The executive's own lines stay harmless.
7. Never write a label word: `expects_reply`, `promiseDue` and the like (identifier forms), or a line that starts with `promise:`, `due:` or `expects reply:`. Ordinary words such as "due to" or "I promise" are fine.
8. Made-up names and reserved domains only; no run of 9 or more digits.
9. Run `bun run sim check <scenario> --part <sent part> --batches NNN-NNN` until it prints `ok`. Then run `sim blind-export` for the range. Commit only the text and blind files of your range.

A rewrite (after `sim reconcile`) fixes only the listed cases and never changes the slot.

### 8.2 What the checker sees

`<sent part>/blind/batch-NNN.json`: for each case `id`, `from`, `to`, `cc`, `subject`, `sentAt` (UTC, ISO), `body` and `threadSubjects` (the subjects of the earlier mails of the thread, oldest first). Nothing else.

### 8.3 Checker steps

Read only this section and `<sent part>/blind/batch-NNN.json`. Never open `slots/`, `texts/`, other `labels/`, the plan specs or the scenario, and never run `sim brief`, `sim reconcile` or `sim status`.

1. Run `bun run sim stale <scenario> --part <sent part> --batches NNN-NNN`. It prints `stale <id>` for each case that needs a label.
2. For each listed id, read the mail as a mail and write one label (8.4, 8.5).
3. Write `/tmp/f116-s04/labels-NNN.json` as `[{ "id": "…", "expectsReply": true, "promise": true, "due": "2026-11-20", "promiseDue": "2026-11-25" }]`.
4. Run `bun run sim label-import <scenario> --part <sent part> --batch NNN --checker <your model id> --file /tmp/f116-s04/labels-NNN.json`.
5. Run `bun run sim check <scenario> --part <sent part> --batches NNN-NNN`. It must print `ok`.

### 8.4 Label meanings

- `expectsReply`: true when the executive asks something that a recipient has to answer, or waits for a recipient's answer. False for thanks, FYI, a report of what someone else said, a closing offer such as "let me know if you have questions", and a mail to over 10 recipients. A question that sits in a forwarded mail and is meant for other people does not count; a question of the executive above it does.
- `due`: the date by which the executive wants the answer, as `YYYY-MM-DD`. `null` when the mail names no date, when `expectsReply` is false, or when the date does not resolve (8.5).
- `promise`: true when the executive makes a **firm** promise of their own (the executive will send, call, decide, deliver) **with a date or a time word** that resolves (8.5). A conditional promise ("if the budget passes, I will send it"), a promise of another person and a promise with no date are `false`.
- `promiseDue`: the date of that promise as `YYYY-MM-DD`; `null` exactly when `promise` is false.

### 8.5 Time-word rules and the time zone

A date resolves from the mail's **sent date in the scenario time zone, `Europe/Warsaw`** (not UTC): convert `sentAt` to Warsaw time first (UTC+1 in winter, UTC+2 in summer time). The label is a local day.

- `today` ("dziś", "today") is the sent day. `tomorrow` ("jutro") is the next day.
- A weekday ("w poniedziałek", "by Friday") is the next such day after the sent day, never the sent day itself.
- `end_of_week` ("do końca tygodnia", "by end of week") is the Friday of the sent week. It is the next Friday when the mail is sent on a Friday at 17:00 Warsaw time or later, or on a Saturday or Sunday.
- `next_week` ("w przyszłym tygodniu") is the next Monday.
- A written date is that date.
- A date before the sent day, or more than 60 days after it, does not resolve: the label is `null` (for a promise: `promise` false, `promiseDue` `null`).

Example 1: `sentAt` `2026-11-18T09:00:00.000Z` is Wednesday 2026-11-18, 10:00 in Warsaw. "Do piątku" gives `2026-11-20`. "By end of week" gives `2026-11-20`. "Next Wednesday" gives `2026-11-25`.
Example 2: `sentAt` `2026-11-18T23:30:00.000Z` is Thursday 2026-11-19, 00:30 in Warsaw (the local day is already the next one). "Jutro" gives `2026-11-20`, not `2026-11-19`.

### 8.6 Freeze

`sim reconcile <scenario> --part <sent part> --batches NNN-NNN` prints `disagree <id> fields <names>` for each fresh label that differs from the slot label in `expectsReply`, `promise`, `due` or `promiseDue` (`null` equals `null`; the slot's time word counts as the day it resolves to). A disagreement blocks the freeze until a rewrite of the text (the writer) or a recorded slot removal; the checker's label never changes the slot.
`sim freeze <scenario> --bank sent` runs `check` on both parts, then needs a fresh agreeing label for every case, at least 245 holdout and 49 dev cases. It writes `sent-manifest.json` (`sent-v1`); a later freeze writes `sent-v2` only when a part hash changed, else it prints `unchanged sent-vN`. A planned id with no slot (a recorded slot removal) is listed as `dropped` in the manifest. Refusal codes: `unwritten`, `unlabelled`, `label_disagrees`, `too_few`.

### 8.7 Holdout rule

`sent-holdout` is the extractor gate set (stage 06). Prompt work reads `sent-dev` only. In code, `sentEvalCasesOf(root, scenario, "sent-holdout", { holdout: true })` loads the holdout; the call without the option throws.

## 9. Live lab (F113)

The frozen `week` part also plays in real time on the sim stack `ea-sim` (`bun run lab`): the injector sends each slot at its time, delegate bots answer, a scripted executive taps, and a scorer writes the report to `evals/results/`. The lab reads only `scenario.json` and `week/`, never `holdout/`. Runbook: `deploy/README.md` § Sim stack. What the lab does and does not do: `docs/capabilities/live-lab.md`.
