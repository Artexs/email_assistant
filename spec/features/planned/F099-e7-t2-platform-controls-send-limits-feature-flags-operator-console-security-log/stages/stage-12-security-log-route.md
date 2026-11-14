# F099 stage 12 — Security log route [risky]

Part of [`../plan.md`](../plan.md). Read its D25, D26, D27, D28, "Facts checked" and "Rules for every stage" first. Lane C, first stage. Needs stage 06 (`/api/me` `features`). Uses `listAuditEvents` of stage 08 if stage 08 landed; else this stage adds it exactly as stage 08 step 8.1 defines it (interface and test 2), and stage 08 reuses it.

`[risky]`: security data, tenant and role filter. A review job checks it before the land; the reviewer tries to read another organization's rows and the assistant's view.

Two steps. About 250 changed lines.

- [ ] **12.1 The registry and the flag**
  - Goal: one list says which audit events are security events and how the web names them; the flag `security_log` exists.
  - Files:
    - add `packages/core/src/security-log.ts` and `packages/core/src/security-log.test.ts`; change `packages/core/src/index.ts`;
    - change `packages/core/src/features.ts` (the flag) and every test that lists the registry keys (`grep -rn "sent_sync" packages apps --include=*.test.ts`: `features.test.ts`, `web-operator.test.ts` case 4, `org-flag-cli.test.ts` and others; add `security_log` with `false` where they list all keys);
    - add `apps/server/src/modules/audit/security-events.test.ts` (the registry against `auditEvents`).
  - Interfaces:

    ```ts
    // packages/core/src/security-log.ts — pure
    export const securityEventKinds = [
      "sign_in", "locked", "password_set", "password_changed", "sessions_ended", "other_sessions_ended",
    ] as const; // E7-T6 adds the 2FA kinds, E7-T3 the export, delete and DSR kinds
    export type SecurityEventKind = (typeof securityEventKinds)[number];

    // audit event code → kind (plan D25); the codes are the values of auditEvents in apps/server/src/modules/audit
    export const securityEvents = {
      "web.login": "sign_in",
      "web.login_locked": "locked",
      "web.password_set": "password_set",
      "web.password_changed": "password_changed",
      "web.sessions_revoked": "sessions_ended",
      "web.other_sessions_revoked": "other_sessions_ended",
    } as const satisfies Record<string, SecurityEventKind>;
    export const securityEventCodes: readonly string[]; // Object.keys(securityEvents)
    export function securityKindOf(event: string): SecurityEventKind | null; // Object.hasOwn

    export const SECURITY_LOG_LIMIT = 50;
    export const SECURITY_LOG_DAYS = 90;

    // features.ts, a fourth entry
    security_log: {
      default: false,
      description: "The security log in the Account card (owners).",
      epic: "E7-T2",
      removeBy: "2027-03-01",
    },
    ```

  - Decisions: D25, D26.
  - Test:
    1. `security-log.test.ts`: every value of `securityEvents` is in `securityEventKinds` and every kind is used once; `securityKindOf("web.login")` = `"sign_in"`; `securityKindOf("toString")` and `securityKindOf("org.plan_changed")` = `null`.
    2. `security-events.test.ts` (server unit test): every key of `securityEvents` is a value of `auditEvents`.
    3. `features.test.ts`: the registry has `security_log` with `default: false`, epic `E7-T2` (it matches the epic pattern), remove-by `2027-03-01`.
  - Check: `bun test packages/core/src apps/server/src/modules/audit`; `bun run typecheck`.
  - Done when: tests 1–3 pass and every test that lists all registry keys includes `security_log`.
  - Out of scope: the route (step 12.2).

- [ ] **12.2 `GET /api/security-log`**
  - Goal: an owner of an organization with `security_log` on reads the newest security events of the organization.
  - Files:
    - change `packages/core/src/web/` (add `security-log.ts` with the schema; export from `web/index.ts`);
    - add `apps/server/src/modules/tenancy/security-log.ts` (`listSecurityLog`); change `tenancy/index.ts`;
    - change `apps/server/src/modules/tenancy/routes.ts` (the route);
    - change `apps/server/src/modules/audit/repo.ts` only if `listAuditEvents` does not exist yet (see the stage header);
    - add `apps/server/test/integration/web-security-log.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/web/security-log.ts
    export const securityLogActorSchema = z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("member"), name: z.string() }),
      z.strictObject({ kind: z.literal("former_member") }),
      z.strictObject({ kind: z.literal("operator") }),
      z.strictObject({ kind: z.literal("system") }),
    ]);
    export const securityLogEntrySchema = z.strictObject({
      at: z.iso.datetime(),
      kind: z.string(), // a SecurityEventKind; a string so an older web build never fails on a new kind
      actor: securityLogActorSchema,
      lockedUntil: z.iso.datetime().nullable(),
    });
    export const securityLogSchema = z.strictObject({ entries: z.array(securityLogEntrySchema) });
    export type SecurityLog = z.infer<typeof securityLogSchema>;

    // tenancy/security-log.ts (tenancy may import audit: layers.json sameLayerEdges tenancy → audit)
    export async function listSecurityLog(db: Db, ctx: TenantContext, now: Date): Promise<SecurityLog>;
    //   rows = listAuditEvents(db, ctx, { events: securityEventCodes, since: now − SECURITY_LOG_DAYS days, limit: SECURITY_LOG_LIMIT });
    //   names = listMemberships(db, ctx) → user_id → display_name;
    //   actor: a member's user id → { kind: "member", name }; "cli" → operator; "system" → system; any other → former_member;
    //   kind = securityKindOf(row.event) (a row whose event left the registry is skipped);
    //   lockedUntil = typeof data.locked_until === "string" && it parses as a date ? its ISO text : null

    // tenancy/routes.ts — owner only, behind the flag (plan D26)
    //   app.get("/security-log", requireOwner, async (c) => {
    //     const ctx = c.get("ctx");
    //     if (!(await isFeatureOn(deps.db, ctx, "security_log"))) return c.json({ error: "not_found" }, 404);
    //     return c.json((await listSecurityLog(deps.db, ctx, deps.now())) satisfies SecurityLog);
    //   });
    ```

  - Decisions: D26, D27, D28. The flag check comes after `requireOwner`, so an assistant gets 403 whatever the flag says.
  - Test (`web-security-log.test.ts`; the real routers as in `web-me.test.ts`; `org = await webOrg(db)`; `NOW = 2026-11-20T10:00:00Z` as the routers' `now`; `security_log` on for A with `upsertOrgFeature` unless a case says off; committed audit rows in A through `recordAudit`, deleted in `afterAll`; rows: `web.login` by the owner −1 h, `web.login_locked` by the assistant −2 h with `data: { via: "web", locked_until: "2026-11-20T08:15:00.000Z" }`, `web.password_changed` by a user id that is no member −3 h, `web.other_sessions_revoked` by `cli` −4 h, `web.terms_accepted` by the owner −30 min (not a security event), `web.login` by the owner −91 days, `web.login` in B −1 h):
    4. No session → 401; the assistant of A → 403 `owner_only` (flag on and off).
    5. The owner of A with the flag off → 404 `{ error: "not_found" }`.
    6. The owner of A with the flag on → 200; `securityLogSchema.parse` passes; entries in this order: `sign_in` (actor `{ kind: "member", name: "Owner" }`), `locked` (actor member `Assistant`, `lockedUntil` `2026-11-20T08:15:00.000Z`), `password_changed` (actor `former_member`), `other_sessions_ended` (actor `operator`); no `terms` row, no −91 days row, no B row.
    7. 55 `web.login` rows in A in the last day → 50 entries, the newest first.
    8. `FEATURES_OFF` holds `security_log` (`configureFeatures({ off: ["security_log"] })`, reset in `afterEach`) → 404 for the owner.
    9. The body as text holds no `@x.test`, no user id of the fixtures and no organization name.
    10. The owner of B (flag off in B) → 404; with the flag on in B → only B's row.
  - Check: `bun test apps/server/test/integration/web-security-log.test.ts apps/server/test/integration/web-me.test.ts apps/server/test/integration/web-operator.test.ts packages/core/src`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 4–10 pass.
  - Out of scope: the web section (stage 13); 2FA, export, delete and DSR kinds (E7-T6, E7-T3).

## Done when

- Steps 12.1 and 12.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 12 (`/tmp/f099-s12`) prints `PROOF_OK`.
