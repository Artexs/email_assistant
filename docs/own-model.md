# Run the product on an own model

> Checked against the code at `72a3992e`, 2026-11-19.

This guide is for an operator who wants the LLM calls to stay on a server that the operator runs. It describes what the code does at the checked commit. The decision is [ADR 0035](decisions/0035-llm-endpoint-eu-and-own-model.md). The rules of the endpoint setting are in [triage.md](capabilities/triage.md) rule 16.

**Status.** No own model has a measured result yet. This guide does not say that an own model sorts mail as well as `gpt-6-luna`. It does not say that it sorts mail worse. Measure first (see Results).

## 1. What an own endpoint changes

- **Mail text goes only to your server.** `OPENAI_BASE_URL` picks one endpoint for the whole deployment. Every LLM role that uses the provider `openai` calls that endpoint. A role that you set to `gemini` still calls Google, so leave no role on `gemini` (rules: `docs/architecture.md` §6.3).
- **The key of OpenAI never reaches your server.** An own endpoint gets `OPENAI_OWN_API_KEY` or the fixed text `own`. It gets no `OPENAI_API_KEY`, `OPENAI_ORG_ID` or `OPENAI_PROJECT_ID` (`triage.md` rule 16).
- **The cost is 0 in the reports of the product.** `triage:cost`, the weekly cost line (M7) and the lab spend price an `own` call at 0, also for a model with no price row (`measurement.md` rule 8). The cost model adds only the fixed share of the VPS (`packages/core/src/metrics/cost-model.ts`). It does not count your GPU, your power or your disk. The USD cap of an eval run does not apply to an `own` run (`evals/README.md` § Endpoint). The cap in calls (`LLM_DAILY_CAP`) still counts every call.
- **No outside LLM service gets mail text.** The sub-processor registry does not show this yet. It lists OpenAI when `LLM_PROVIDER` is `openai`, and it has no condition for the endpoint (`packages/core/src/legal/subprocessors.ts`). The static legal pages say "this install uses OpenAI". They hold for the home VPS install only (`docs/legal/claims.md`). A change of the registry or the texts needs the owner and a `TERMS_VERSION` bump. This guide does not make that change.
- **The other roles use the same server.** With no `LLM_<ROLE>_MODEL`, the judge, the drafter and the extractor use the model of the classifier (`config-llm.ts`, `llmRoleTable`). Nobody measured an own model for these roles. Set `LLM_<ROLE>_PROVIDER` and `LLM_<ROLE>_MODEL` for each role that you want on another model.

## 2. What is not supported

- **A hosted OpenAI-compatible API** (Azure OpenAI, OpenRouter and the like). Its cost and its sub-processor are unknown. The start refuses it unless `OPENAI_ENDPOINT_KIND=own` is set. Set that value only for a server that you run.
- **Plain http to another host.** The URL must be `https`. Plain `http` works only for loopback (`127.0.0.0/8`, `::1`, `localhost`) or a one-label host name (a container on the same machine, for example `ollama`).
- **A one-label name must be a container.** Do not use a name of a LAN host that your DNS search domain completes. The check sees one label and allows plain http. Mail text then crosses your network without encryption.
- **A server on another host needs https and `OPENAI_ENDPOINT_KIND=own`.** An OpenAI host cannot get this kind. A bad value stops the start. The error names `OPENAI_BASE_URL` and never the value.

## 3. Hardware

- **The home VPS cannot host a model.** It has 4 GB of RAM (PD-055). PD-112 says that the home VPS does not host a model.
- **The owner's PC (fact F5 of the F111 plan, checked 2026-11-15).** It has an AMD RX 6950 XT with 16 GB of video memory. PD-112 asks for at least 12 GB. `ollama` and `ollama-cuda` 0.40.7 were installed; `ollama-rocm` (the AMD build) was not. Owner step O2 installs it.
- **GPU memory in use:** not measured yet (stage 05).
- **Seconds per mail:** not measured yet (stage 05).
- **Longest prompt:** not measured yet (stage 05). Stage 05 must keep it below 7168 tokens (8192 minus 1024).
- **Mail volume.** Plan with 200 mails a day for one mailbox. This is the figure of the report `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md`. The mean of that run is 1462 prompt tokens and 90 output tokens per mail. So 200 mails are 292,400 prompt tokens and 18,000 output tokens a day. These numbers are for the prompt `classifier-v2`, which production runs at the checked commit (`productionClassifierChoice`). The prompt `classifier-v3` is longer (1520 tokens in; `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v3.md`).

## 4. Setup with Ollama

The spike of F111 stage 01 sent the real request of the adapter to Ollama 0.40.7 with the model `gemma3:1b`. Three of three answers parsed (`notes/2026-11-15-ollama-responses-path.md`). So the product needs no chat-completions path, and the code has no `OPENAI_API_STYLE` key. The limit of that test: one small model, one short English mail, CPU only. The candidate models `SpeakLeash/bielik-11b-v3.1:Q4_K_M` and `gemma3:12b` are not tested yet.

1. Install Ollama and pull the model. Start `ollama serve` with `OLLAMA_CONTEXT_LENGTH=8192`.
2. Set these lines in the `.env` of the server (the keys are in `.env.example`):

   ```
   LLM_PROVIDER=openai
   OPENAI_MODEL_CLASSIFIER=<the model tag in Ollama>
   OPENAI_BASE_URL=http://127.0.0.1:11434/v1
   OPENAI_TIMEOUT_MS=<milliseconds>
   ```

   - `OPENAI_API_KEY` is not needed for an own server. Set `OPENAI_OWN_API_KEY` only if your server wants a key. It is a secret.
   - If the server runs in a container, `127.0.0.1` is the container itself. Use the name of the Ollama container, for example `http://ollama:11434/v1`.
   - For a server on another host, use `https://<host>/v1` and add `OPENAI_ENDPOINT_KIND=own`.
   - `OPENAI_TIMEOUT_MS` is 30000 in `.env.example`. A large model on slow hardware can need more. Stage 05 gives measured seconds per mail later.
   - An own server gets no `reasoning` field. `OPENAI_REASONING_EFFORT` has no effect there.

3. Restart the server. Run `bun run llm:check`. It prints `endpoint=own host=<host>` and an answer from the model.
4. **Why `OLLAMA_CONTEXT_LENGTH=8192`.** The plan of F111 treats a cut prompt as a main risk (decision D10): a prompt that is longer than the context window is cut, and the model then answers about a part of the mail. The spike prompt used 868 of 8192 tokens. A real prompt with a long mail is longer. Do not use a smaller value.

## 5. The `auto` rule at the checked commit

The ticket F110 has landed in the code. It ties every `auto` to the model setup that earned it (`docs/capabilities/trust.md` rules 5 and 9). The setup, the "key", holds the provider, the model, the reasoning effort, the prompt version, the endpoint kind and, for `own`, the host.

- **A switch to an own model changes the key.** `auto` counts only when the key of its grant equals the running key. After the switch, `auto` is off at once: the moves are logged and not made.
- **The re-gate runs at every start and every 5 minutes.** It looks at each category with `auto` on. A grant of another key moves to the new key only when the grant is not `forced` and the global evidence for the new key is eligible (a final `go` file for that key, a history check that did not fail, real labels that are not `no-go`). Otherwise `auto` goes off, the pending moves expire, and the owner gets a notice for `info`, `notification` and `spam`.
- **The evidence for an own model is a gate file.** The file must be in `evals/results/gate` of the image. Its provider, model, prompt version, endpoint `own` and host must equal the running key. At the checked commit the folder holds gate files for `gpt-6-luna` on the standard endpoint only, and they are provisional (`trust.md` rule 2). So no own model has evidence, and no category of an own model can pass the global gate.
- **What you do before a switch.** Read the release rule of `deploy/README.md` (§ Trust ladder). If this install has not run the F110 release yet, set every `auto` category back to `assist` first. That release stamps each old `auto` as `legacy` for the running key, and the stamp would then name the own model without evidence. Turn `auto` on again only for a category that passes the gate on the new model.
- **The gate for turning `auto` on.** With the flag `trust_ladder` on, the gate needs a global file for the running key. With the flag off, the gate uses your real labels (`bun run triage:label`). A forced `auto` keeps the grant `forced`. The re-gate never moves a `forced` grant to a new key (`trust.md` rules 5 and 6).

## 6. Results

Not measured yet. Stage 05 adds the numbers after owner step O2.
