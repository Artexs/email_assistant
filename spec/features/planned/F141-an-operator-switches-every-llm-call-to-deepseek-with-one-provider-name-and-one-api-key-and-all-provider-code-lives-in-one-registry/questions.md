# F141 questions (defaults taken; owner to confirm)

1. [important: privacy] Plan P4: config refuses `LLM_PROVIDER=deepseek` with `TRIAGE_LLM_SCOPE=all`, because DeepSeek has no sub-processor row and real mail must not reach it. Default: refuse. Undo: drop the `realMail: false` flag of the deepseek row (then a sub-processor row and legal text are needed first).
2. [important: production] Plan P5, D6, owner step O1: a removed key (`LLM_<ROLE>_PROVIDER/_MODEL/_REASONING`, `OPENAI_MODEL_CLASSIFIER`, `GEMINI_MODEL_CLASSIFIER`, `OPENAI_REASONING_EFFORT`) with a value stops the server start; an empty value passes. The VPS `.env` must lose these lines before the deploy of the release that carries stage 04. Default: stop the start. Undo: make the check a warning log line.
3. [important: user-visible] Plan P6: an own model server reads its model from the new key `OPENAI_OWN_MODEL`; `OPENAI_MODEL_CLASSIFIER` goes. The own-model guide changes. Default: new key. Undo: keep the old key name for the own endpoint only.
4. [important: money] Plan P3: DeepSeek price rows use the peak rates (off-peak is half), so reports show an upper bound. Default: peak. Undo: a later price row with an hour rule.
5. [minor] Plan P1: the drafter effort `low` and the other efforts are fixed in code per role (from the committed gate files), no env key. Default: fixed. Undo: an eval flag pins another effort for one run.
6. [minor] Plan D8: `--provider` of an eval or `llm:check` run sets every role of that run; `--judge-provider` moves only the judge. Default as written.
7. [minor] Plan D10: the server still starts without the provider key while `TRIAGE_LLM_SCOPE=off` (CI, e2e and the drill need that); every LLM tool fails at once and names the key.
