# F121 stage 08 — Read-only viewer in the fake Telegram

Part of [`../plan.md`](../plan.md). Decision 12 (epic), notes §4.5. Runs next to 02–06.

Carry-over reads: `tools/fake-telegram/src/server.ts`, `control.ts`, `state.ts` (how chats, messages and buttons are stored), its tests, `docs/capabilities/digest-and-notices.md` (what bot messages look like).

## Step 1 — The view

**Goal.** A video or a person sees the bot chat as a chat, read-only, clearly fake.

**Files.** New `tools/fake-telegram/src/view.ts` and test; route in `control.ts`.

**Decisions.**
- `GET /_fake/view` lists chats (id, message count, links); `?chat=<id>` shows that chat's bot messages oldest first, with time, text (line breaks kept), inline buttons as labels, and edits shown as the latest text.
- Every text is HTML-escaped; `parse_mode` HTML from the bot is rendered as plain escaped text with only `<b>`, `<i>`, `<code>` turned into the same tags after escaping (a fixed allow list), never raw.
- A banner at the top: "Test Telegram — not real". No script, no form, no outside asset; inline CSS only, a phone-width layout (max 420 px) for the video.
- Same loopback rule as the other `/_fake/*` routes; an unknown chat id → 404 with an escaped message.
- `?chat=<id>&refresh=2` adds `<meta http-equiv="refresh" content="2">` for the recording; no other query keys.

**Test.**
1. A message with text `<script>alert(1)</script>` renders as `&lt;script&gt;…`; the page has no `<script` tag.
2. `<b>Urgent</b>` in an HTML message renders as `<b>Urgent</b>`; `<a href="x">` renders escaped.
3. A message with two inline buttons shows both labels and no `<form>` or `<button>`.
4. Three messages show in send order; an edited message shows its latest text once.
5. Unknown chat → 404.
6. `refresh=2` adds the meta tag; `refresh=abc` → no tag.

Mutation: remove the escape call → test 1 fails.

**Check.** `bun test tools/fake-telegram/src`.

**Done when.** Tests 1–6 pass; Proof prints `PROOF_OK`.

**Out of scope.** Pressing buttons from the view (the driver does that); any change to the fake bot API.
