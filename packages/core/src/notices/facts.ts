import type { NoticeKind } from "./kinds";
import type { NoticeView } from "./views";

// The facts of a notice that a phone message may carry: how many items it names, and the id of the one item that a tap opens.
// The push payload (`PushPayload`) holds these two and nothing else of the view. A string of the view (a sender, a subject, an
// address, a name) is never a fact: the only text that passes is an id of our own (an action, a set or a delegation).
export interface NoticeFacts {
  count: number;
  itemId: string | null;
}

/** The largest count that a payload carries (`pushPayloadSchema`). */
export const MAX_FACT_COUNT = 99_999;

// `itemId` is the id of the item a tap opens in the panel:
// - `approval`, `send_result`: the id of the action; `approval_set`: the id of the set; `delegation_answered`: the delegation id.
// - `urgent`, `not_triaged`: null. The tap opens the list (`/activity?category=urgent`), and the id of the mail never leaves the server.
// - every other kind: null.
// `count` is the number of items that the view names: the items of an approval set, the replies of `replies_ready`, else 1.
// A kind that has no push renderer gets the same two facts; the minimal Telegram render reads them too.
export function noticeFactsOf<K extends NoticeKind>(kind: K, view: NoticeView<K>): NoticeFacts {
  const facts = factsOf(kind as NoticeKind, view as never);
  return { count: Math.min(facts.count, MAX_FACT_COUNT), itemId: facts.itemId };
}

function factsOf(kind: NoticeKind, view: NoticeView<NoticeKind>): NoticeFacts {
  switch (kind) {
    case "approval":
      return { count: 1, itemId: (view as NoticeView<"approval">).actionId };
    case "send_result":
      return { count: 1, itemId: (view as NoticeView<"send_result">).actionId };
    case "approval_set": {
      const set = view as NoticeView<"approval_set">;
      return { count: set.items.length, itemId: set.setId };
    }
    case "delegation_answered":
      return { count: 1, itemId: (view as NoticeView<"delegation_answered">).delegationId };
    case "replies_ready":
      return { count: (view as NoticeView<"replies_ready">).count, itemId: null };
    default:
      return { count: 1, itemId: null };
  }
}
