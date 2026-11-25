---
opened: 2026-11-26
---

# F173 · An operator runs production on DeepSeek with one setting, and the privacy papers name it

## Outcome

The owner decided (2026-11-26) that DeepSeek may serve production mail. An operator sets `LLM_PROVIDER=deepseek` on the VPS and the server starts. Today config refuses that value together with `TRIAGE_LLM_SCOPE=all` outside the sim stack, because DeepSeek has no sub-processor row. The papers stay true: DeepSeek appears wherever they list AI providers.

## Scope

- Start at the config check named in `docs/decisions/0015-llm-provider-switch.md` (third row, `deepseek`): lift the refusal for production, keep `OPENAI_BASE_URL` refusing the DeepSeek host.
- Add DeepSeek as a sub-processor row (`packages/core/src/legal/subprocessors.ts`) and follow it through the privacy page, DPA, DPIA, ledger and the public claim, as the OpenAI row does.
- A production start with `deepseek` and a key passes `check-server-env.sh`; the ADR and `docs/capabilities/` say production may use it.
- Quality gate: run the sim holdout gate for every role on the DeepSeek models and record the result; a role that fails its bar keeps its owner switch off.

## Out of scope

- Removing OpenAI or Gemini; per-role providers (one `LLM_PROVIDER` stays).
- Moving any real organization's mail before the papers land.
- Switching the VPS itself: the owner or coordinator does it after the release of this ticket.

## Acceptance

- Config accepts `LLM_PROVIDER=deepseek` with `TRIAGE_LLM_SCOPE=all` in production; a test shows the old refusal gone and the host check still refusing a wrong base URL.
- The sub-processor list, privacy page and DPA name DeepSeek with its purpose and region; the docs-stale and legal checks pass.
- Gate files for each role on DeepSeek exist, or the role is listed as off with the failing number.
- A release note says what changes for users: the privacy page lists a new provider.

## Notes

- The VPS `.env` runs `openai` now (set 2026-11-26 after a crash loop). Needs plan: start a planner job; the two-owner steps are the DeepSeek terms check and the region answer, default "as listed by the provider".
