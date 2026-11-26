# DeepSeek sim gate on lab-01

The four gate runs that decide which roles may run on a DeepSeek install (`LLM_PROVIDER=deepseek`). Run on 2026-11-26 (UTC) on the production prompt of each role. Every run used `--provider deepseek` on the standard endpoint (`api.deepseek.com`). Spend is from the spend ledger.

| role | prompt | model, effort | command | result | cost USD | flag decision |
| --- | --- | --- | --- | --- | --- | --- |
| classifier | `classifier-v2` | `deepseek-flash`, none | `bun run eval --sim lab-01 --part holdout --provider deepseek --budget-usd 2` (run twice: the second run retried the 9 error cases) | gate file `evals/results/gate/classifier-classifier-v2-deepseek-flash-none-lab-01-v1.json`; 4 error cases left of 1413 (bar for the switch: 0). go set: info, notification; OpenAI go set: notification, spam; O2 no | 0.9123 | The VPS stays on `openai`. |
| drafter, holdout | `drafter-v4` | `deepseek-flash`, low | `bun run eval --sim lab-01 --part holdout --drafter --judge --provider deepseek --budget-usd 2` | off: "send as is or small edit" 190/255 (74.5 %), bar ≥ 80 %; 9 drafts hold a leaning sentence (10 sentences), bar ≤ 2 drafts. Gate file `evals/results/gate/drafter-drafter-v4-deepseek-flash-low-lab-01-v1.json` (`passed: false`). Judge `deepseek-v4-pro`, `judge-v3` | 0.8075 | `reply_drafts` stays off on a DeepSeek install. |
| drafter, reply injection set | `drafter-v4` | `deepseek-flash`, low | `bun run eval --set reply-injection --drafter --judge --provider deepseek --budget-usd 1` (run twice: the second run graded 1 case that got no grade) | pass: 14/14, bar 100 %. Judge `deepseek-v4-pro`, `judge-v3`. No gate file: this set writes none | 0.0378 | See the drafter decision. |
| extractor | `extractor-v1` | `deepseek-flash`, none | `bun run eval --sim lab-01 --part sent-holdout --extractor --provider deepseek --budget-usd 2` (run twice, see the notes) | gate file `evals/results/gate/extractor-extractor-v1-deepseek-flash-none-lab-01-vsent-v1.json` (PASS: expects_reply recall and precision lower bound 97.0 %, promise precision lower bound 91.4 %, due exact 97.4 %, 0 leaks) | 0.1401 | `open_loops` may be on for a DeepSeek install. |

Total spend: $1.8977. The plan cap was $14. The ledger month total for 2026-11 is now $9.43 of the $20 cap.

**Drafter decision: off.** The drafter is on only when runs 2 and 3 both pass. Run 3 passes and run 2 fails, so `reply_drafts` stays off on a DeepSeek install.

**Stylist.** It had no run, and `style_from_sent` stays off whatever the result.

## Notes

- **Classifier, O2.** The switch rule needs 0 error cases, and a `go` set that contains the `go` set of the running OpenAI file. The 4 errors are model answers that fail the output schema. Two have a `task` that is too long (delegation cases). Two have a `language` value outside the list (German cases). So the result is O2 no, whatever the `go` set.
- **Classifier, OpenAI go set.** The plan names the OpenAI `go` set as `notification, spam`, but that set is from the `classifier-v3` file. The production prompt is `classifier-v2`. The `go` set of the running OpenAI file (`classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json`) is `info` only. The DeepSeek `go` set contains `info`, so only the error count blocks the switch.
- **Classifier, spam.** On DeepSeek, `spam` is no-go: the precision is 89.1 % and its lower bound is 84.8 %, against the 98 % bar.
- **Drafter judge.** The DeepSeek drafter runs used the DeepSeek `strong` judge (`deepseek-v4-pro`, `judge-v3`). The OpenAI drafter files used `gpt-6.1-terra`, `judge-v3`. The OpenAI `drafter-v4` holdout scored 242/255 (94.9 %) "send as is" under its own judge. The two numbers come from different judges, so they do not compare one to one.
- **Extractor, first run.** The first run got HTTP 400 on every call, and the run stopped with exit 4. DeepSeek refused two shapes of the extractor JSON schema: an `anyOf` branch that is only an `anyOf`, and `format: date`. The DeepSeek adapter now sends a schema that DeepSeek accepts (`toDeepseekJsonSchema` in `apps/server/src/platform/llm/providers/deepseek.ts`). The resume ran on that fix. The classifier, drafter, stylist and judge schemas do not change under the fix, so runs 1 to 3 still hold.
- **Reports.**
  - `evals/results/2026-11-26-sim-lab-01-holdout-deepseek-flash-classifier-v2.md`
  - `evals/results/2026-11-26-sim-lab-01-holdout-deepseek-flash-drafter-v4-reply-judge-deepseek-v4-pro-judge-v3.md`
  - `evals/results/2026-11-26-reply-injection-deepseek-flash-drafter-v4-reply-judge-deepseek-v4-pro-judge-v3.md`
  - `evals/results/2026-11-26-sim-lab-01-sent-holdout-deepseek-flash-extractor-v1.md`
