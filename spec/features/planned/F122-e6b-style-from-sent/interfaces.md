# F122 · Interfaces

Part of [plan.md](plan.md). These names are the contract between stages. A stage that must change one asks first.

## Core (`packages/core/src/replies/style-suggest.ts` or a sibling file)

- `StyleSource`: `{ bodyText: string; toAddresses: string[]; ccAddresses: string[] }` (one sent mail; the addresses only feed the name check, never the prompt).
- `cutQuotedReply(text: string, opts: { signature: string | null }) → string` (D4).
- `buildStyleSamples(sources: StyleSource[], opts: { signature: string | null }) → { samples: string[]; names: string[] }`: cut each text (D4), drop empty ones, keep the input order (newest first), cut each to `STYLE_SAMPLE_MAX_CHARS` = 1,500 and stop at `STYLE_SAMPLES_MAX_CHARS` = 60,000 in total. `names` = the name tokens of `styleNameTokens`.
- `styleNameTokens(sources: StyleSource[]) → string[]`: from each recipient address the local-part pieces (split on `.`, `_`, `-`, `+`) of 3+ letters; from each cut text the word after a greeting word (`Dear`, `Hi`, `Hello`, `Cześć`, `Witam`, `Pan`, `Pani`, `Panie`) and every capitalised word that does not start a sentence or a line, minus a stop list (Polish honorifics `Pan`, `Pani`, `Pana`, `Panu`, `Panią`, `Panie`, `Państwo`, `Państwa`, `Państwu`; `I`, `Mr`, `Mrs`, `Ms`, `Dr`; weekday and month names in pl and en; `English`, `Polish`); lower case, unique, sorted. Known limit: a name that the samples never show capitalised mid-sentence passes; the owner reads the text before Save.
- `STYLE_MIN_SAMPLES` = 5, `STYLE_MAX_SOURCES` = 100.
- `stylistOutputSchema` (zod): `{ style: string }` (1–4,000 code points after trim, strict), so `too_long` is a check failure with a retry, not a schema failure.
- `checkStyleSuggestion(text, { names: string[]; samples: string[]; language: "pl" | "en" }) → { ok: true } | { ok: false; failures: StyleCheckCode[] }`. `StyleCheckCode`: `address`, `link`, `phone`, `account_number` (the detectors of `checkReplyBody`, with no allowed list), `control_chars`, `quote_line` (a line that starts with `>`), `copied_text` (8 words in a row, compared in lower case with punctuation removed, that appear in one sample), `name` (a capitalised word whose lower case is in `names`, or shares its first 4 letters with a `names` token of 4+ letters: Polish forms), `too_long` (> 1,000), `language` (the `language.ts` counter gives the other language; `unknown` passes).

## Prompt registry (module `triage`)

- Role `stylist` in `llmRoles`, `llmRoleModels.stylist` = `light` / `low`.
- `stylist-v1.ts`: `buildSystem()`, `buildUser({ samples, language, nonce })`. `prompts.stylist` = `stylistVersions["stylist-v1"]`; `stylistVersionIds` for the eval flag.

## Server (module `replies`)

- `createStyleSuggestion(deps: { db, llm, dailyCap, now, realMail, scope })` → `(ctx, mailboxId, { userId, language })` →
  `{ kind: "suggestion"; text; count } | { kind: "failed"; reason: "llm_off" | "llm_cap" | "checks" | "output" | "provider" } | { kind: "sent_off" } | { kind: "too_few"; count } | { kind: "blocked"; reason: "oauth_mailbox" } | { kind: "limit" } | { kind: "busy" } | { kind: "not_found" }`. `count` = samples sent.
- Module `mail`: `listStyleSources(db, ctx, mailboxId, { since, limit, testOnly })` → `StyleSource[]`, newest first, the D3 filter (also `action_id` null). Plain `Db` or a transaction; writes nothing.

## Route (stage 02b)

`POST /api/mailboxes/:id/profile/style-suggestion`, body `{}` (strict; a key → 400). Session (401), flags (404), owner (403), then the mailbox (404).
- 200 `{ text, count }`; 200 `{ kind: "failed", reason }`.
- 409 `{ error: "sent_off" }`, 409 `{ error: "too_few", count }`, 409 `{ error: "blocked", reason: "oauth_mailbox" }`.
- 429 `suggest_limit`, 429 `suggest_busy`.
- Core schemas in `@ea/core/web` (profile schemas file): `styleSuggestionAnswerSchema` (the 200 shapes).
- Audit `mailbox.style_suggested`: `mailbox_id`, `count`, `outcome` (with a model call: `suggestion`, `checks`, `output`, `provider`; without: `too_few`, `sent_off`, `llm_off`, `llm_cap`); `via` = `web`. `limit`, `busy`, `blocked` and `not_found` write no row. The day limit counts only the outcomes with a model call.
- Flag `style_from_sent` in `packages/core/src/features.ts`: epic `E6b`, default off, remove-by `2027-03-01`.

## Eval (stages 06–09)

- Style file (written by stage 06, read by stage 07), JSON at `evals/results/styles/<scenario>-<part>-<promptVersion>-<model>-<effort>.json`: `{ scenario, part, promptVersion, model, effort, sampleCount, text, checks: { ok: boolean, failures: string[] }, usd }`. Synthetic text only.
- `bun run eval --sim lab-01 --part sent-dev|sent-holdout --stylist [--stylist-prompt <v>] [--model …] [--reasoning-effort …] [--budget-usd …] --out <report.md>`: writes the report and the style file.
- `bun run eval --set style-injection --stylist`: the injection set (stage 06). It writes the injection result file `evals/results/styles/style-injection-<promptVersion>-<model>-<effort>.json`: `{ promptVersion, model, effort, passed, total, usd }`.
- Drafter eval option `--style none|scenario|<style file path>` (default `scenario`, today's behaviour). The style key (`none`, `scenario` or the style file's `promptVersion`) is part of the state file name, the report name and the dump name.
- `judge-v4` in `judgeVersions`: the reply rubric of `judge-v3` plus score `style_match` (0–2); its user prompt gets `referenceStyle` (scenario `executive.voice`; injection set: its persona voice). `style_match` does not count in "send as is". The default judge stays `judge-v3`.
- `bun run eval:style-gate --a <state file> --b <state file> --style <style file> --injection <injection result file> --out <report.md>` (stage 08): the paired comparison; writes `evals/results/gate/stylist-<stylist promptVersion>-<stylist model>-<stylist effort>-lab-01-v1.json` only when both runs are full judged holdout runs with `judge-v4` and the same drafter prompt, model and effort.
