import type { Category } from "../triage/categories";

export const categoryLabels: Record<Category, { emoji: string; name: string }> = {
  urgent: { emoji: "🔴", name: "Urgent" },
  needs_reply: { emoji: "✉️", name: "Reply" },
  delegation: { emoji: "👥", name: "Delegate" },
  unsure: { emoji: "❓", name: "Unsure" },
  info: { emoji: "ℹ️", name: "Info" },
  notification: { emoji: "🔔", name: "Notification" },
  spam: { emoji: "🚫", name: "Spam" },
};

export function categoryTag(category: Category): string {
  const { emoji, name } = categoryLabels[category];
  return `${emoji} ${name}`;
}
