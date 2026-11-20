// The facts of the page `reference/autonomy-evidence`: only what holds with every feature flag off (the owner rule of 2026-11-15:
// no user page describes what a default-off flag gates). Each number comes from the code constant that owns it, never from page text.
// The facts and their sources: `docs/capabilities/trust.md` rules 5 and 9 (the grant and the re-gate carry no flag),
// `docs/capabilities/triage.md` (the go/no-go bar), `docs/capabilities/actions-and-undo.md` (Undo).
import {
  barCategories,
  DAY_MS,
  DEFAULT_THRESHOLD,
  evidenceKeySchema,
  GATE_BAR,
  GATE_MIN_KEPT,
  mailboxModes,
  type BarCategory,
  UNDO_WINDOW_MS,
} from "@ea/core";

export interface EvidenceFact {
  id: string;
  title: string;
  text: string;
}

// The names that the panel uses (reference/categories). A new category is a type error here.
const CATEGORY_NAME: Record<BarCategory, string> = {
  urgent: "Urgent",
  needs_reply: "Needs reply",
  info: "Info",
  notification: "Notifications",
  spam: "Spam",
};

const listNames = (names: readonly string[]): string =>
  `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export function autonomyEvidenceFacts(): EvidenceFact[] {
  const startMode = mailboxModes[0];
  const keyParts = Object.keys(evidenceKeySchema.shape).length;
  const undoDays = UNDO_WINDOW_MS / DAY_MS;
  return [
    {
      id: "start-state",
      title: "The start state",
      text: `A new mailbox starts in ${startMode} mode. Auto is off for each of the ${barCategories.length} categories that can have it: ${listNames(barCategories.map((name) => CATEGORY_NAME[name]))}. The start limit of confidence is ${DEFAULT_THRESHOLD} for each category.`,
    },
    {
      id: "go-no-go-bar",
      title: "The go/no-go bar",
      text: `A category passes the check for auto when its precision is at least ${Math.round(GATE_BAR * 100)} % on at least ${GATE_MIN_KEPT} mails that you rated. With fewer rated mails the card says that it needs more ratings and shows no precision.`,
    },
    {
      id: "rating-sources",
      title: "Where the ratings come from",
      text: "Ratings come from the digest buttons that mark a sort as right or wrong, from the Activity page, from each Undo and from mail that you move back by hand.",
    },
    {
      id: "ai-setup",
      title: "Auto belongs to one AI setup",
      text: `When auto goes on for a category, the system stores the AI setup that was running. The stored setup has ${keyParts} parts: the provider, the model, the reasoning effort, the prompt version, the prompt parts, the endpoint and, for an endpoint of your own, its host. Auto counts only while the running setup equals the stored one.`,
    },
    {
      id: "re-check",
      title: "The check after a change of the AI setup",
      text: "The system checks every auto switch again at each start and then on a schedule. After a change of the AI setup, a switch stays on only when the new setup has proof for the category. Otherwise the system turns auto off, drops the moves that it planned and did not make yet, and sends a notice to the owners. It moves no mail back.",
    },
    {
      id: "undo",
      title: "Undo",
      text: `Each automatic move can be undone for ${undoDays} days. An Undo counts as a rating: the system records that the sort was wrong.`,
    },
    {
      id: "vip",
      title: "VIP mail",
      text: "A mail from a VIP sender never gets an automatic move or a mark as read, whatever the check says.",
    },
  ];
}
