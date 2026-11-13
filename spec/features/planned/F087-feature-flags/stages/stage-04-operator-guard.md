# F087 stage 04 — Operator guard [risky]

Part of [`../plan.md`](../plan.md). Read its D5, D15–D17, D25, "Facts checked" (P1, P2) and "Rules for every stage" first. Needs stages 1–3 (stage 1 for `platform/config.ts`; stages 2 and 3 for a clean base).

`[risky]`: auth. A review job checks it before the land. No route uses the guard yet: stage 5 adds the first one.

One step. About 150 changed lines.

- [ ] **4.1 `OPERATOR_USER_IDS` and `requireOperator` for every `/api/operator/*` path**
  - Goal: the server knows who the operator is from env only; every path under `/api/operator` answers a non-operator exactly like a path that does not exist.
  - Files:
    - change `apps/server/src/platform/config.ts` and `config.test.ts`;
    - change `.env.example` (after `FEATURES_OFF`);
    - change `apps/server/src/platform/http.ts` and `http.test.ts`;
    - change `apps/server/test/integration/web-helpers.ts` (one optional field).
  - Interfaces:

    ```ts
    // platform/config.ts, baseSchema
    // Comma list of user ids (users.id, UUID) who may use /api/operator/*. Empty = no operator. Never log the ids.
    OPERATOR_USER_IDS: z.preprocess(emptyAsUndefined, z.string().optional()),
    // superRefine: every parseList entry passes z.uuid(), else
    //   ctx.addIssue({ code: "custom", path: ["OPERATOR_USER_IDS"], message: "each entry must be a user id (UUID)" })
    export function operatorUserIds(config: Config): ReadonlySet<string>; // lower-cased, unique

    // platform/http.ts
    export interface WebDeps {
      // … existing fields …
      operatorUserIds?: ReadonlySet<string>; // D16: absent = nobody is an operator
    }
    // D15: 404 { error: "not_found" } unless the session user is in web.operatorUserIds.
    // A refusal logs log.warn(`operator route refused for user ${userId}`) — the id only.
    export const requireOperator: MiddlewareHandler<ApiEnv>;
    // createApp, the api block, in this order:
    //   api.use("*", requireSession);
    //   api.use("*", requireTenant({ … }));
    //   api.use("/operator/*", requireOperator);   // new: guards the whole prefix (P2)
    //   api.use("*", refuseSuspendedWrites);
    ```

    `.env.example`:

    ```
    # User ids (users.id, UUID, comma list) of the operator: only they reach /api/operator/*, every other user gets 404.
    # A user id, not an e-mail address. Empty = no operator. Never log the ids.
    OPERATOR_USER_IDS=
    ```

    `web-helpers.ts`: `WebTestOptions.operatorUserIds?: ReadonlySet<string>`, passed into `WebDeps` only when set (the same spread as `isOrgSuspended`).

  - Decisions: D5, D15, D16, D17.
  - Test:
    - `config.test.ts`, new `describe("OPERATOR_USER_IDS")` (base `fullEnv`):
      1. Unset and `""` → `operatorUserIds(config).size` is 0.
      2. `"0B0F3B3E-6F1C-4D57-9D0E-3F0A8F6F2A11, 0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11"` → a set with the one lower-case id.
      3. `"0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11,admin"` → `configError(...).keys` equals `["OPERATOR_USER_IDS"]`.
    - `http.test.ts`, new `describe("requireOperator")`. `requireOperator` reads only `operatorUserIds` from `web`, so the test app sets a partial `WebDeps` with a cast:

      ```ts
      const appFor = (operatorUserIds?: ReadonlySet<string>) => {
        const app = new Hono<ApiEnv>();
        app.use("*", async (c, next) => {
          c.set("session", { userId: c.req.header("x-user") ?? "u-none", sessionId: "s-test" });
          c.set("web", (operatorUserIds === undefined ? {} : { operatorUserIds }) as WebDeps);
          await next();
        });
        app.use("*", requireOperator);
        app.get("/x", (c) => c.json({ ok: true }));
        return app;
      };
      ```

      4. `appFor(new Set(["u-op"]))`, header `x-user: u-op` → 200 `{ ok: true }`.
      5. Same app, `x-user: u-other` → 404 `{ error: "not_found" }`; one `console.error` line that contains `operator route refused for user u-other`.
      6. `appFor()` → 404 for `u-op` too.
      7. The order in `createApp` (no DB): `createApp({ checkDb: async () => true, web })` with a fake `web` built like `makeWeb` in `apps/server/test/integration/web-http.test.ts:54` (copy the fields you need; `getSession` answers user `u-owner`, `listMembershipsOfUser` answers `[{ org_id: "org-1", role: "owner" }]`, `operatorUserIds` = `new Set(["u-op"])`, `routers` mounts `api.get("/operator/x", …)` and `api.get("/me-x", …)`) → `u-owner` gets 404 on `/api/operator/x` and 200 on `/api/me-x` (the prefix guard does not leak, P1).

  - Check: `bun test apps/server/src/platform/config.test.ts apps/server/src/platform/http.test.ts`; `bun run typecheck`.
  - Done when: tests 1–7 pass; `createApp` has the guard line in the order above.
  - Out of scope: the route and the cross-organization read (stage 5); TOTP for the operator (ADR 0026); a `/operator` page; letting an operator without a membership through (D17).

## Done when

- Step 4.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 04 (`/tmp/f087-s04`) prints `PROOF_OK`.
