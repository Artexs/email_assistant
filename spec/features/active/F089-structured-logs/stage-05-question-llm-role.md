# Question from stage 05: the `role` field of the LLM debug lines

F090 stage 3 added `role=${call.role}` to the two debug lines of `platform/llm/client.ts` and a test (`client-roles.test.ts`, "the debug log holds the role and the model") that reads `role=judge`.
The stage 05 table omits `role`, and `role` is not in `logFieldNames` (`platform/log-fields.ts`). The stage rule says a missing field is a question, not an addition.

What the worker did: `llm_call_ok` and `llm_call_failed` carry no `role`. The test of `client-roles.test.ts` now checks `llm_call_ok` and `model=gem-j` (test renamed "the debug log holds the model, not the prompt or the key").

Decision needed: add `role` to `logFieldNames` (values are the closed set of LLM roles, so D7 holds) and put `role: call.role` back in both lines and the test? Recommended: yes, one small change in a later stage or a follow-up commit.
