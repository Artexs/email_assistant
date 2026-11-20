// The e2e server pins the classifier setup, so the gate fixture (`apps/web/e2e/gate-fixture/`) matches the running key
// whatever a developer's `.env` says: the provider `openai` gives the tier model `gpt-6-luna` with effort `none`. Every
// removed key and the own-endpoint keys are set to empty text, so an old developer `.env` cannot reach the e2e server
// with a removed key (config refuses it). `e2e-gate-fixture.test.ts` checks the fixture against this pin, that the pin
// covers every removed key, and the production prompt choice.
export const E2E_LLM_PIN = {
  LLM_PROVIDER: "openai",
  OPENAI_MODEL_CLASSIFIER: "",
  GEMINI_MODEL_CLASSIFIER: "",
  OPENAI_REASONING_EFFORT: "",
  LLM_JUDGE_PROVIDER: "",
  LLM_JUDGE_MODEL: "",
  LLM_JUDGE_REASONING: "",
  LLM_DRAFTER_PROVIDER: "",
  LLM_DRAFTER_MODEL: "",
  LLM_DRAFTER_REASONING: "",
  LLM_EXTRACTOR_PROVIDER: "",
  LLM_EXTRACTOR_MODEL: "",
  LLM_EXTRACTOR_REASONING: "",
  OPENAI_OWN_MODEL: "",
  OPENAI_BASE_URL: "",
  OPENAI_ENDPOINT_KIND: "",
} as const;
export const E2E_GATE_FIXTURE_DIR = "apps/web/e2e/gate-fixture";
