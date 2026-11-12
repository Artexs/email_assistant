# Control surface (Stage 2 E4): facts learned in discovery

- F034 (own-mail header check) is already built: `apps/server/src/main.ts:72` wires `isOwnActionId` into the sync (`modules/mail/sync.ts:180`). The planned ticket `spec/features/planned/F034-own-mail-header-check/` is stale.
- The panel already shows "why" and confidence: `apps/web/src/components/activity/ActivityRow.tsx:34` (category and confidence), `ActivityPanel.tsx:52–57` (AI text). The Telegram digest shows `💬` why and `→` would-do lines (`packages/core/src/digest/digest.ts:111–112`) but no confidence.
- Autonomy per category with the go/no-go gate exists in the panel: `apps/web/src/components/settings/CategoriesCard.tsx`, server `apps/server/src/modules/triage/gate.ts`. Bar 0.98, minimum 30 kept rows (`packages/core/src/web/settings.ts:11–12`).
- `organizations.style_text` is used only as the signature (`packages/core/src/outgoing/message.ts:78–79`).
- The IMAP fetch reads only two headers: `references`, `x-ea-action-id` (`apps/server/src/modules/mail/imap/client.ts:53`). List-Unsubscribe needs a fetch change and a column.
- `actions.approved_via` is a free `text` column (`db/migrations/20261104000001_triage.sql:90`).
- Delegation statuses: `drafted`, `sent`, `answered`, `overdue`, `done`, `cancelled` (`modules/delegation/repo.ts:8`). Delegates have no edit and no delete in the service, only add and active on/off.
- Notice quiet hours are a constant 22:00–07:00 (`packages/core/src/digest/local-time.ts:17`).
- `hono-openapi` 1.5.0 (2026-10-18) supports Zod 4; the server uses Hono 4.13 and Zod 4.1.
- RFC 8058 one-click: both `List-Unsubscribe` (HTTPS URI) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` under a valid DKIM signature; the receiver POSTs that body.
- The `emails` table stores no IMAP flags (`\Seen`, `\Answered`, `\Flagged`); the IMAP client fetches flags only for folder metadata (`modules/mail/imap/client.ts:55`). The history check of ADR 0028 needs them stored.
