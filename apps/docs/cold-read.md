# Cold read of the built docs site

This file is not a page of the site (it is outside `src/content`). The coordinator gives it to a fresh agent that has never seen the repository. The agent answers ten buyer questions from the built site only. Then the coordinator compares the answers with the expected sources below.

## Prompt for the scout

Follow `apps/docs/cold-read.md`. Answer each question from the built site only, quote the page. Then compare with the expected sources and list each mismatch.

## Build the site

1. `bun run docs:build`
2. The output is the folder `apps/docs/dist/`. English pages are `dist/<page>/index.html`; Polish twins are under `dist/pl/`.

## Rule

Read only the built HTML in `apps/docs/dist/`. Do not read the repository, the source pages, the claims file or the ledger. A fact that you cannot find in the built HTML is "not on the site": say so, do not guess.

## Questions and expected sources

Notation: `claim:<id>` is the row with that id in the claims table of the page `security` (`publicClaims`, anchor `#claim-<id>`). `page:<id>` is the English page with that id. `section:<name>` is a section of a page.

| #   | Question                            | Expected source                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | What does it do?                    | `page:index`, section "What it does": nothing slips, less time in the inbox, trust and privacy.                                                                                                                                                                                                |
| 2   | Who is it for?                      | `page:index`, section "Who it is for": managers and executives who answer a lot of mail.                                                                                                                                                                                                       |
| 3   | Which mail hosts does it work with? | `page:index` section "What is different" (any IMAP host with a password) and `page:faq`; the provider list is in `page:start`.                                                                                                                                                                 |
| 4   | Who holds a copy of my mail?        | `claim:mail-storage` (the install server), `claim:ai-provider-receives` (the AI provider), `claim:telegram`, `claim:backups`; the table "Services that get data" in `page:security`.                                                                                                           |
| 5   | Is my mail used for training?       | Only in `page:security`, section "What this product does not promise", item "Facts that come only from the AI provider": the provider states no training on paid API data; the project has not checked the contract. Also `claim:ai-provider-keeps`. The claims table makes no training claim. |
| 6   | Where is it processed?              | Only in `page:security`, section "What this product does not promise", item "No EU-only AI processing by default", and the EU-region statement of the provider. Also `claim:ai-provider-receives`. The claims table makes no location claim.                                                   |
| 7   | Can it send without me?             | `claim:never-sends-alone`: an owner approves each draft. Also `claim:shadow-first` and `claim:undo`.                                                                                                                                                                                           |
| 8   | What does it cost?                  | `page:pricing`: a placeholder price, marked "Not for sale", with the cost table for 50, 100 and 200 mails a day. No real price exists.                                                                                                                                                         |
| 9   | How do I delete my data?            | `claim:export-and-delete` (the operator deletes an organization or erases one person on written request) and `claim:retention` (what the daily job clears, and when).                                                                                                                          |
| 10  | How do I see it work?               | While no video is published: `page:start`, the tutorial. After the owner has published the video (owner gate G3, pinned by `DEMO_VIDEO_SHA256`): the video on `page:index`, and `page:start` as the written route.                                                                             |

## Compare

For each question: quote the page and section that the agent used, then say if it equals the expected source. List a mismatch when the answer is wrong, comes from another page, claims more than the source says, or answers question 5 or 6 from the claims table. Also list a question that the agent could not answer from the site.
