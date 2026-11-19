import type { FakeMessage, FakeState } from "./state";

export const VIEW_TITLE = "Test Telegram — not real";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** The one place a text becomes markup-safe. Every text in the page goes through it. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

// The only tags that come back after escaping: a fixed allow list, no attributes.
const ALLOWED_TAGS = ["b", "i", "code"] as const;

/** Escapes the text, then turns balanced `<b>`, `<i>` and `<code>` pairs back into the same tags. */
export function renderBotText(text: string): string {
  let html = escapeHtml(text);
  for (const tag of ALLOWED_TAGS) {
    html = html.replace(new RegExp(`&lt;${tag}&gt;([\\s\\S]*?)&lt;/${tag}&gt;`, "g"), `<${tag}>$1</${tag}>`);
  }
  return html;
}

const REFRESH_PATTERN = /^[1-9]\d?$/;

/** A refresh interval in seconds (1–99), or null when the value is absent or not a plain integer. */
export const parseRefresh = (value: string | null): number | null =>
  value !== null && REFRESH_PATTERN.test(value) ? Number(value) : null;

const STYLE = `
body{margin:0;background:#dfe6ec;font-family:system-ui,sans-serif;color:#111}
main{max-width:420px;margin:0 auto;min-height:100vh;background:#fff}
.banner{background:#b00020;color:#fff;text-align:center;font-weight:600;padding:8px}
h1{font-size:16px;margin:0;padding:10px 12px;background:#e8eef4}
ul{list-style:none;margin:0;padding:12px}
li{margin:6px 0}
.msg{margin:8px 12px;padding:8px 10px;background:#eef3f8;border-radius:10px;white-space:pre-wrap;word-wrap:break-word}
.time{display:block;font-size:11px;color:#667;margin-top:4px}
.buttons{margin-top:6px;white-space:normal}
.btn{display:inline-block;margin:2px 4px 2px 0;padding:4px 10px;border:1px solid #9ab;border-radius:6px;background:#fff;font-size:13px}
.row{display:block}
`;

const page = (body: string, refreshSeconds: number | null = null): string =>
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(VIEW_TITLE)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">${
    refreshSeconds === null ? "" : `\n<meta http-equiv="refresh" content="${refreshSeconds}">`
  }
<style>${STYLE}</style></head><body><main>
<div class="banner">${escapeHtml(VIEW_TITLE)}</div>
${body}
</main></body></html>
`;

const clock = (date: number): string => new Date(date * 1000).toISOString().slice(11, 19);

function renderMessage(message: FakeMessage): string {
  const rows = message.buttons
    .map(
      (row) => `<span class="row">${row.map((b) => `<span class="btn">${escapeHtml(b.text)}</span>`).join("")}</span>`
    )
    .join("");
  return `<div class="msg">${renderBotText(message.text)}${
    rows === "" ? "" : `<div class="buttons">${rows}</div>`
  }<span class="time">${clock(message.date)} UTC</span></div>`;
}

/** The chat as a read-only page. Pure: no network, no clock. `null` lists the chats. */
export function renderChatView(state: FakeState, chatId: number | null, refreshSeconds: number | null = null): string {
  if (chatId === null) {
    const items = state
      .chatIds()
      .map((id) => `<li><a href="?chat=${id}">Chat ${id}</a> — ${state.messages(id).length} messages</li>`)
      .join("");
    return page(`<h1>Chats</h1><ul>${items === "" ? "<li>No chats yet.</li>" : items}</ul>`);
  }
  const bot = state.messages(chatId).filter((message) => message.from === "bot");
  return page(`<h1>Chat ${chatId}</h1>\n${bot.map(renderMessage).join("\n")}`, refreshSeconds);
}

/** The 404 page for an unknown chat; the id is user input, so it is escaped. */
export const renderNoChat = (rawId: string): string =>
  page(`<h1>No such chat: ${escapeHtml(rawId)}</h1><p><a href="?">All chats</a></p>`);
