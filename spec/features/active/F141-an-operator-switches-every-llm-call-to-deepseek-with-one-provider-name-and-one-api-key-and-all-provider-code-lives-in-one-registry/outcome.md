
## Coordinator records (2026-11-20)

- C-env done: the main `.env` holds no removed key (`OPENAI_ENDPOINT_KIND`, `OPENAI_BASE_URL`, `OPENAI_MODEL_CLASSIFIER`, `LLM_JUDGE_*`); `OPENAI_OWN_API_KEY` renamed to `DEEPSEEK_API_KEY`; `LLM_PROVIDER=deepseek`; `TRIAGE_LLM_SCOPE` is not set (off). Backup of the old file: `~/.cache/env-before-c-env.bak` (mode 600).
- R1 done: `bun run llm:check` on DeepSeek, classifier, `reasoning.effort "none"`: accepted. Greeting 1.1 s, triage check 1.0 s, category `needs_reply`, host `api.deepseek.com`, model `deepseek-flash`.
