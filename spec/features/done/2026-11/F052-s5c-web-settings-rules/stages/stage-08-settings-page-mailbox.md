# s5c-web-settings-rules — Stage 8

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 8 — Settings page part 1: selector, Mode and actions with the `assist` dialog, Categories with "Set anyway", Synced folders

Two steps. Stage 9 adds the general section to the same page.

- [x] **8.1 The page frame, the selector, Mode and actions, the `assist` dialog (S2, S3, S5, S10, B12)**
  - Goal: the owner picks a mailbox, sees its status and scopes, switches the mode and the five tool switches; an assistant sees the same read-only.
  - Files: change `apps/web/src/islands/SettingsPage.tsx`, `apps/web/src/lib/use-resource.ts` (`mutate`); create `apps/web/src/components/settings/MailboxSelector.tsx`, `ModeCard.tsx`, `AssistDialog.tsx`, `apps/web/src/lib/settings-api.ts`, `settings-api.test.ts`.
  - Interfaces:

    ```ts
    // lib/settings-api.ts (thin wrappers over api(); unit-tested with a fake fetch like api.test.ts)
    export function settingsPath(mailboxId: string, tail = ""): string; // `/api/settings/${encodeURIComponent(id)}${tail}`
    export function selectedMailboxId(list: readonly { id: string }[], query: string | null): string | null; // the query id when listed, else the first, else null
    export function switchesAfterAssist(
      current: SettingsWebView["toolSwitches"],
      keep: boolean
    ): (keyof SettingsWebView["toolSwitches"])[]; // the names that are on after the change (ASSIST_DEFAULT_SWITCHES when keep is false)

    // components/settings/MailboxSelector.tsx
    export function MailboxSelector(props: {
      mailboxes: MailboxView[];
      value: string;
      onChange(id: string): void;
    }): JSX.Element;
    // components/settings/ModeCard.tsx
    export function ModeCard(props: {
      mailbox: MailboxView;
      settings: SettingsWebView;
      isOwner: boolean;
      onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
    }): JSX.Element;
    // components/settings/AssistDialog.tsx
    export function AssistDialog(props: {
      mailbox: MailboxView;
      switches: SettingsWebView["toolSwitches"];
      open: boolean;
      onOpenChange(open: boolean): void;
      onChoose(keepSwitches: boolean): void; // the parent sends the PATCH
      pending: boolean;
    }): JSX.Element;
    ```

  - Decisions:
    - `SettingsPage`: `AppShell` (`active "settings"`, title `title_settings`) around `<Settings />`. `Settings` uses `useMe()` (role, timezone, address list for the toasts), `useResource(() => api("/api/mailboxes", mailboxListSchema))`, the selected id in state (initial `selectedMailboxId(list, new URLSearchParams(location.search).get("mailbox"))` once the list loads; a change writes `?mailbox=<id>` with `history.replaceState`, the pattern of `MailboxesPage.tsx:30-37`), and a second `useResource` for `GET settingsPath(id)` with `settingsViewSchema` that restarts when the id changes (key the inner component by the id: `<MailboxSettings key={id} … />`, so its resource starts fresh).
    - Layout (S3): one column, `max-w-3xl`, `flex flex-col gap-4`. Mailbox section: the selector, then a row with `StatusBadge` and `ScopeBadges` (S10; reuse `components/mailboxes/*`), then the cards of this stage and 8.2. For an assistant the line `set_owner_only` shows at the top of the section (S2). No mailbox: `set_no_mailbox` and a link `set_open_mailboxes` to `/mailboxes`; the general section (stage 9) still shows. Page states (U4): skeleton cards while loading (`aria-busy="true"`), `set_load_error` + `retry` on an error.
    - `ModeCard`: the title `mode_title`; the current mode name and text (`mode_shadow` / `mode_shadow_text` or `mode_assist` / `mode_assist_text`); `moves_unsupported` as a muted line when `!settings.movesSupported`; the owner button `mode_to_assist` (opens `AssistDialog`) or `mode_to_shadow` (no dialog, U5: `PATCH mode { mode: "shadow", keepSwitches: false }` → toast `mode_shadow_toast`). Then the five switches in `toolSwitchNames` order, each a `Switch` with `id` and a `Label htmlFor` (`switch_<name>`), `checked` from `settings.toolSwitches`, `disabled` for an assistant or while its request runs; a change → `PATCH switches/<name> { value }` → toast `switch_on_toast` / `switch_off_toast` with `{ name: t("switch_<name>") }`.
    - `AssistDialog` (S5, U5): title `assist_title`; text `assist_text` with `{ address }`; `ScopeBadges` of the mailbox; two choices as two buttons with their hints: `assist_usual` (primary, first in the tab order) with `assist_usual_hint`, and `assist_keep` (outline) with `assist_keep_hint` and `{ list }` = the labels of `switchesAfterAssist(current, true)` joined by `, ` (or `assist_none_on`); `cancel`. A choice → the parent sends `PATCH mode { mode: "assist", keepSwitches }` → toast `mode_assist_toast`, the dialog closes; the buttons are disabled while `pending`; an error → `toast.error(t(errorText(error)))` and the dialog stays open.
    - Every change result: the page replaces its settings data with `change.settings` (no extra GET), calls `useMe().reload()` after a mode change (the onboarding item, D15) and reloads the mailbox list (its `mode` field); when `change.expired > 0` the toast text adds ` ${t("expired_suffix", { count })}`. `useResource` needs a way to set data: add `mutate(data: T)` to `useResource` (sets `data`, clears `error`, keeps polling; a small change in `lib/use-resource.ts`, used by the settings and rules pages). A load that started before a `mutate` must not overwrite it with older data: keep a sequence number in a ref, bump it in `mutate` and in each `run`, and drop a load answer whose number is not the latest.
    - Errors of any PATCH: `toast.error(t(errorText(error)))` (403 → `owner_only`, 404 → `err_not_found` and a reload of the mailbox list).
    - A removed mailbox (cold review finding 1): after every mailbox-list load, when the list no longer holds the selected id (removed in another tab) or the selection is `null` and the list now has a mailbox, set the selection to `selectedMailboxId(list, current)` (and write the query); a settings `GET` that answers 404 calls the list's `reload()` instead of showing `set_load_error`.
    - Every settings card has a `data-card` attribute (`mode`, `categories`, `folders`; stage 9 adds `digest`, `signature`, `timezone`, `account`) for the Playwright scopes of stage 11.
    - Switch labels and every text come from `en.ts` (stage 7); no literal in JSX (lint).
  - Test (unit, `settings-api.test.ts`): `selectedMailboxId([{ id: "a" }, { id: "b" }], "b")` → `"b"`; `(…, "x")` → `"a"`; `([], null)` → `null`; `switchesAfterAssist({ move: false, mark_read: false, flag: false, create_draft: true, move_unsure: true }, false)` → `["move", "mark_read", "flag", "create_draft"]` (move_unsure off, create_draft kept); with `keep: true` → `["create_draft", "move_unsure"]`; `settingsPath("a b")` encodes the space.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`; a hand check: `bun run web:build`, `bun run dev` in the worktree (`TELEGRAM_BOT_TOKEN=` empty, `WEB_MAIL_ALLOW_LOCAL=true` on the command line), sign in through a `web:invite` link, a GreenMail mailbox connected through the Mailboxes page ("Other", `127.0.0.1:3143` / `3025`), then on `/settings` at 400 px and 1280 px in the headless Chromium (`CHROMIUM_PATH`): switch to assist (both choices once), a switch off and on, back to shadow; screenshots; zero console or CSP errors.
  - Done when: the build and the hand check pass.
  - Out of scope: the categories and folders (8.2); the general section (stage 9).

- [x] **8.2 Categories with the gate and "Set anyway", Synced folders (S1, S4, B5, B12)**
  - Goal: the owner sets `auto` per category behind the gate, with "Set anyway" after a refusal, and switches the synced folders.
  - Files: create `apps/web/src/components/settings/CategoriesCard.tsx`, `SetAnywayDialog.tsx`, `SyncFoldersCard.tsx`; change `apps/web/src/islands/SettingsPage.tsx`.
  - Interfaces:

    ```ts
    export function CategoriesCard(props: {
      settings: SettingsWebView;
      isOwner: boolean;
      onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
    }): JSX.Element;
    export function SetAnywayDialog(props: {
      category: BarCategory | null; // null = closed
      gate: GateView | null;
      bar: number;
      minKept: number;
      pending: boolean;
      onCancel(): void;
      onConfirm(): void;
    }): JSX.Element;
    export function SyncFoldersCard(props: {
      settings: SettingsWebView;
      isOwner: boolean;
      onChanged(change: SettingsWebChange, toastKey: TextKey, vars?: Record<string, string | number>): void;
    }): JSX.Element;
    ```

  - Decisions:
    - `CategoriesCard`: title `cat_title`; `cat_help` with `{ bar: formatPercent(settings.bar), minKept: settings.minKept }`; one row per `settings.categories` item: the name `cat_<category>`, the `Switch` (`aria-label` = `cat_auto_label` with the name; disabled for an assistant or while pending), `cat_threshold` with `{ value: formatConfidence(threshold) }`, the gate text (`gateText(gate, bar, minKept)`), the effect line `cat_effect_<category>` (muted).
    - Turning on: `PATCH auto/<category> { auto: true }`; 200 → toast `auto_on_toast`; an `ApiError` with `code === "no_go"` → `noGoBodySchema.safeParse(error.raw)` → open `SetAnywayDialog` with that gate (fall back to the row's gate when the parse fails); "Set anyway" → `PATCH … { auto: true, force: true }` → toast `auto_on_toast` and close; Cancel → close, the switch stays off. Turning off: `PATCH … { auto: false }` → toast `auto_off_toast`. No dialog for off (U5).
    - `SetAnywayDialog` (S4, U5): title `anyway_title`; the gate text of the 409's gate; `anyway_text` with `{ category: t("cat_<category>") }`; buttons `cancel` and `anyway_submit` (`variant="destructive"`, disabled while pending).
    - `SyncFoldersCard` (S1): title `folders_title`; per row of `settings.syncFolders`: the name `folder_<key>` and the server path in muted text (`path`, rendered as text); INBOX with `folders_always` and no switch; the others a `Switch` (`aria-label` = the folder name) → `PATCH sync-folders/<key> { enabled }` → toast `folder_on_toast` / `folder_off_toast`. Only INBOX → `folders_only_inbox`. `folders_note` under the list.
    - The page order (S3): Mode and actions, Categories, Synced folders.
  - Test: no unit test beyond stage 7's `gate-text` (React components; Playwright covers the page in stage 11). Hand check as in 8.1: `auto` on `info` → the dialog (an empty GreenMail mailbox is `no-go: too few`) → Cancel (still off) → again → Set anyway (on, toast) → off; the folders card shows INBOX only; 400 px and 1280 px; zero console or CSP errors.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`, then the hand check.
  - Done when: the build and the hand check pass; `grep -rn "\"[A-Z][a-z]" apps/web/src/components/settings/*.tsx` shows no UI literal.
  - Out of scope: the general section (stage 9).
