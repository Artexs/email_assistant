# F140 notes — map for the next worker

- Source stages: `spec/features/done/2026-11/F111-e11b-private-model-option/stages/stage-05-own-model-runs.md` and `stage-07-eu-endpoint.md`, with `plan.md`, `questions.md`. Refresh those two stage files first.
- Owner facts (2026-11-19): LM Studio on the PC serves `bielik-11b-v3.1-instruct` and `gemma-3-12b-it` on `localhost:1234`; no Ollama. Stage 05 text names Ollama on `127.0.0.1:11500`.
- Stopped spike: branch `limen/2026-11-19-f111-s05-own-model-holdout-runs-4666fa9b` (305 lines; an OpenAI chat-completions adapter for LM Studio, its tests, `notes/2026-11-19-lm-studio-adapter-spike.md`, `questions-stage-05.md`). The job died with the PC crash ("process group gone"). Keep the branch until this ticket lands or drops.
- Open: does LM Studio's server need the chat-completions path (the spike says the Responses path fails)? The spike's questions file holds the options.
