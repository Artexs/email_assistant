import { cutText, minimalTexts, textsFor, type CoreTexts, type OutMessage } from "@ea/core";

import { listMailboxes, switchMailboxStatus, type MailboxSummary } from "../mail";

import type { CommandDeps } from "./commands";
import { ADDRESS_MAX, telegramDetailOf } from "./commands-shared";
import type { LinkedChat } from "./port";

interface StatusSwitch {
  to: "active" | "paused";
}

// `switchMailboxStatus` does one transaction per mailbox: the conditional update and its audit row.
export async function switchMailboxes(deps: CommandDeps, link: LinkedChat, change: StatusSwitch): Promise<OutMessage> {
  const texts = textsFor(link.locale).bot.switch;
  if (link.role !== "owner") return { text: texts.ownerOnly, buttons: [] };
  const now = deps.now();
  const ctx = { orgId: link.orgId, userId: link.userId };
  const changed: string[] = [];
  const extra: string[] = [];
  // `minimal`: a mailbox is "Mailbox 1", "Mailbox 2" in the order of the list, never its address (as `/status`).
  const minimal = (await telegramDetailOf(deps, link)) === "minimal";
  const mailboxes = await listMailboxes(deps.db, ctx);
  for (const [index, mailbox] of mailboxes.entries()) {
    const address = minimal ? minimalTexts(link.locale).mailboxName(index + 1) : cutText(mailbox.address, ADDRESS_MAX);
    const skip = skipText(mailbox, address, texts);
    if (skip !== null) {
      extra.push(skip);
      continue;
    }
    const result = await switchMailboxStatus(deps.db, ctx, mailbox.id, {
      to: change.to,
      actor: link.userId,
      via: "telegram",
      now,
    });
    if (result.kind === "changed") changed.push(address);
    else if (result.kind === "already")
      extra.push(change.to === "paused" ? texts.alreadyPaused(address) : texts.alreadyActive(address));
    else if (result.kind === "auth_error") extra.push(loginErrorText(mailbox, address, texts));
    else if (result.kind === "host_blocked") extra.push(texts.hostBlocked(address));
  }
  return {
    text: [...changeLines(change.to, changed, texts, deps.syncEveryMin), ...extra].join("\n") || texts.noMailbox,
    buttons: [],
  };
}

// An OAuth mailbox is fixed with Reconnect in the panel, a password mailbox with `mailbox:password`.
function loginErrorText(mailbox: MailboxSummary, address: string, texts: CoreTexts["bot"]["switch"]): string {
  return mailbox.oauth_provider === null ? texts.loginError(address) : texts.loginErrorOAuth(address);
}

// A mailbox in a state that only the system leaves is not paused or resumed: its own line says why.
function skipText(mailbox: MailboxSummary, address: string, texts: CoreTexts["bot"]["switch"]): string | null {
  switch (mailbox.status) {
    case "auth_error":
      return loginErrorText(mailbox, address, texts);
    case "host_blocked":
      return texts.hostBlocked(address);
    case "active":
    case "paused":
      return null;
  }
}

function changeLines(
  to: "active" | "paused",
  changed: string[],
  texts: CoreTexts["bot"]["switch"],
  syncEveryMin: number
): string[] {
  if (changed.length === 0) return [];
  const list = changed.join(", ");
  return to === "paused"
    ? [texts.pausedHeader(list), texts.pausedExplain, texts.pausedResume]
    : [texts.resumedHeader(list), texts.resumedExplain(syncEveryMin)];
}

export function pauseMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  return switchMailboxes(deps, link, {
    to: "paused",
  });
}

export function resumeMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  return switchMailboxes(deps, link, {
    to: "active",
  });
}
