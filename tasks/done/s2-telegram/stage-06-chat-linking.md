# s2-telegram — Stage 6

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 6 — Chat linking: links and one-time tokens [risky]

- [x] **6.1 Link tokens (15 min, one-time, one user) and chat links**
  - Goal: a one-time token binds one Telegram private chat to one member of one organization (ADR 0005, architecture §6.2); a used, expired, unknown or malformed token links nothing.
  - Files: create `apps/server/src/modules/channels/repo.ts` (link and token part), `apps/server/src/modules/channels/linking.ts`, `apps/server/test/integration/channels-linking.test.ts`; change `apps/server/src/modules/channels/port.ts` (type `LinkedChat`), `apps/server/src/modules/channels/index.ts`, `apps/server/src/modules/tenancy/repo.ts` and `tenancy/index.ts` (`getMembership`), `apps/server/src/modules/audit/repo.ts` (two event names), `apps/server/test/integration/fixtures.ts` (`addMember`, `linkChat`, `randomChatId`).
  - Interfaces:
    - `port.ts`: `interface LinkedChat { orgId: string; userId: string; role: MembershipRole; chatId: number; linkedAt: Date }`.
    - `tenancy/repo.ts`: `getMembership(db: Db | Transaction<DB>, ctx: TenantContext, userId: string): Promise<MembershipWithUser | undefined>` (the select of `listMemberships` plus `user_id = userId`).
    - `audit/repo.ts`: `auditEvents.chatLinked = "chat.linked"`, `auditEvents.chatUnlinked = "chat.unlinked"`.
    - `channels/repo.ts` (`DbOrTrx = Db | Transaction<DB>`; `channel` is always `'telegram'`):
      - `insertLinkToken(db: DbOrTrx, ctx: TenantContext, row: { tokenHash: string; userId: string; expiresAt: Date; createdAt: Date }): Promise<void>`
      - `deleteOldTokens(db: DbOrTrx, ctx: TenantContext, userId: string, createdBefore: Date): Promise<number>` — deletes the user's tokens that are not used, and the user's tokens created before `createdBefore`.
      - `useLinkToken(trx: Transaction<DB>, tokenHash: string, now: Date): Promise<{ orgId: string; userId: string } | undefined>` — entry point (D18): `UPDATE chat_link_tokens SET used_at = now WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now RETURNING org_id, user_id`.
      - `findLinkToken(db: DbOrTrx, tokenHash: string): Promise<{ usedAt: Date | null; expiresAt: Date } | undefined>` — entry point (D18).
      - `replaceChatLink(trx: Transaction<DB>, ctx: TenantContext, row: { userId: string; chatId: number; linkedAt: Date }): Promise<{ orgId: string; userId: string }[]>` — deletes the link of this chat in any organization (D18: the chat moves to the token's member), deletes the member's old link in this organization, inserts the new row. Returns the removed links of other members (checkpoint 2 fix, 2026-11-06).
      - `findChatLink(db: DbOrTrx, chatId: number): Promise<LinkedChat | undefined>` — entry point (D18); joins `memberships` for the role.
      - `listLinkedChats(db: DbOrTrx): Promise<LinkedChat[]>` — scheduler entry point (D18); all links, ordered by `org_id`, `user_id`.
      - `getChatLinkForUser(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<LinkedChat | undefined>`
      - `deleteChatLinks(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<number>`
    - `channels/linking.ts`:
      - `const LINK_TOKEN_TTL_MS = 15 * 60_000`; `const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/`
      - `hashLinkToken(token: string): string` — SHA-256 hex (`node:crypto` `createHash`).
      - `createLinkToken(db: Db, ctx: TenantContext, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }>`
      - `type ConsumeResult = { kind: "linked"; orgId: string; userId: string } | { kind: "used" } | { kind: "expired" } | { kind: "unknown" }`
      - `consumeLinkToken(db: Db, input: { token: string; chatId: number; now: Date }): Promise<ConsumeResult>`
      - `unlinkUser(db: Db, ctx: TenantContext, userId: string, now: Date): Promise<number>`
    - Fixtures: `addMember(trx, orgId: string, role: MembershipRole = "assistant"): Promise<string>` (new user + membership, returns the user id; uses the inner `insertUser` / `insertMembership` of `tenancy/repo.ts`); `linkChat(trx, ctx, userId: string, chatId: number, linkedAt: Date): Promise<void>` (a direct insert into `chat_links`); `randomChatId(): number` (a random integer between 10^9 and 10^12, so tests never collide with a real chat id in the dev DB).
  - Decisions:
    - Token = `randomBytes(32).toString("base64url")` (43 characters, the deep-link alphabet `A-Z a-z 0-9 _ -`, ≤ 64). Only its hash is stored (stage 1). The plain token leaves the server only in the CLI output (stage 7).
    - `createLinkToken`: `getMembership` → none → `HardError("user is not a member of this organization")`. One transaction: `deleteOldTokens(trx, ctx, userId, now − 24 h)` (a new token makes the user's older unused tokens invalid), then `insertLinkToken` with `expiresAt = now + LINK_TOKEN_TTL_MS`, `createdAt = now`.
    - `consumeLinkToken`: a token that does not match `LINK_TOKEN_PATTERN`, or a `chatId` that is not a safe integer > 0 → `unknown` (no DB write). Else one transaction: `useLinkToken` → a row → `replaceChatLink(trx, { orgId }, { userId, chatId, linkedAt: now })` and `recordAudit(trx, { orgId }, { actor: userId, event: auditEvents.chatLinked, data: { channel: "telegram" }, at: now })` → `linked`. No row → `findLinkToken`: none → `unknown`; `usedAt` set → `used`; else → `expired` (the time is up). The router (stage 14) decides the reply (D3).
    - `unlinkUser`: one transaction: `deleteChatLinks`; when it deleted a row, `recordAudit(trx, ctx, { actor: "system", event: auditEvents.chatUnlinked, data: { channel: "telegram", user_id: userId, links: n }, at: now })`.
    - Every function here that opens a transaction uses the S1a pattern (`db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run)`): the tests pass a rollback `Transaction` as `db`.
    - `external_chat_id` comes back from Kysely as a string (`Int8`): convert with `Number()` (≤ 52 bits, exact).
    - Who the token wins over: the token proves the member (the CLI made it for that member). So a chat that was linked to another member, also in another organization, moves to the token's member. The old link is deleted, and `chat.linked` records the new one. Checkpoint 2 fix (2026-11-06): for each removed link of another member, `consumeLinkToken` writes `chat.unlinked` in that member's organization, in the same transaction: `actor: "system"`, `reasonCode: "chat_moved"`, `data: { channel: "telegram", user_id }`; no chat id and no id of the new organization or member. A re-link of the same chat by the same member writes no such row.
  - Test (`channels-linking.test.ts`, `withRollback`, fixed `now` = `2026-11-06T10:00:00Z`, chat ids from `randomChatId()`):
    1. `createLinkToken` → the token matches `LINK_TOKEN_PATTERN`; one row whose `token_hash` = `hashLinkToken(token)` and `expires_at` = now + 15 min; `JSON.stringify` of the row does not contain the token.
    2. `consumeLinkToken` at now + 14 min → `linked` with the org and user; one `chat_links` row with the chat id and `linked_at`; the token row has `used_at`; one `chat.linked` audit row with `actor` = the user id.
    3. The same token again → `used`; still one link row.
    4. At exactly now + 15 min → `expired`; no link row.
    5. A random well-formed token → `unknown`; `"short"` → `unknown`; chat ids 0, −5 and 1.5 → `unknown`, and the token row stays unused.
    6. A second `createLinkToken` for the same user → the first token gives `unknown`; the second gives `linked`.
    7. Member A is linked to chat C; member B (`addMember`, same org) uses a token in chat C → chat C belongs to B; A has no link.
    8. A links again from chat D → A's only link is D; chat C's old row is gone.
    9. `createLinkToken` with the context of org X and a user of org Y → `HardError`.
    10. `findChatLink(C)` → `{ orgId, userId, role: "owner", chatId: C, linkedAt }` with `chatId` a number; an unknown chat → undefined; `getChatLinkForUser` with another org's context → undefined.
    11. `unlinkUser` → 1, the link is gone, one `chat.unlinked` row; again → 0 and no new audit row.
    12. Cross-organization move: chat E is linked to org P's owner; org Q's owner uses a token in chat E → chat E is in org Q; P's owner has no link.
    13. `listLinkedChats` contains the test links (the dev DB can hold other rows: check "contains", not "equals").
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the `/start` handler and the replies (stage 14), the CLI (stage 7).
