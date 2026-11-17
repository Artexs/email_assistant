# F103 stage 13 review (Sonnet 5.5, PASS 93f0adb7)

Model: Sonnet 5.5, because the stage is lint rules, a logger type and docs, no migration or send path. No BLOCKING, no TEST GAP.

Notes:
- N1: the lint is syntactic. The reviewer linted 28 snippets; these pass: alias (`const logger = log`), bracket call, destructured method, member logger (`o.log.info`, `this.log.info`), a logger without the `Log` suffix, `.message` through a variable, destructure or `errorFields(err.message)`, `console` through an alias or `globalThis.console`. Caught: spread, variable event string, `log?.info`, ternary or cast second argument, `.message` in a template, `log.with({}).error`. Coordinator added a Limits bullet to `docs/capabilities/logs.md`. Stage 14 may add selectors (member logger, no-suffix) if cheap.
- N2: the `spec/build.md` backlog sentence is replaced (0 `no-restricted-syntax` warnings).
- N3: two tests expect `[2, 2]` for `log.error("config error:", e)` (both selectors fire); the stage text said `[2]`. Harmless.
- N4: docs match the code. The architecture line says the canary "is to prove" the claim (stages 15-16): honest.
- N6: `log_call_invalid` writes `dropped_fields: 1`, no value leaks.
- N7: worker mutation logs do not record the mutation text; the reviewer's four own mutations each fail 1-4 tests.
- 6 lint warnings remain (5 `no-unused-vars`, 1 `no-console` in `web-operator-orgs.test.ts:217`, a test file outside the rule scope).
