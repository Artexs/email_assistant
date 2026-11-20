import type { NoticeDetail } from "@ea/core";

import type { CommandDeps } from "./commands";
import { detailOfUser } from "./detail";
import type { LinkedChat } from "./port";

export const ADDRESS_MAX = 60;

// The detail level of a chat: the effective level of the member of the link now (flag, lock, own level). The same reader as the sender.
export async function telegramDetailOf(deps: CommandDeps, link: LinkedChat): Promise<NoticeDetail> {
  return deps.detailOf === undefined ? detailOfUser(deps.db, { orgId: link.orgId }, link.userId) : deps.detailOf(link);
}
