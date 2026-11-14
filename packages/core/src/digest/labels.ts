import type { CoreTexts } from "../texts";
import type { Category } from "../triage/categories";

export const categoryEmoji: Record<Category, string> = {
  urgent: "🔴",
  needs_reply: "✉️",
  delegation: "👥",
  unsure: "❓",
  info: "ℹ️",
  notification: "🔔",
  spam: "🚫",
};

export function categoryTag(category: Category, texts: CoreTexts): string {
  return `${categoryEmoji[category]} ${texts.categories[category]}`;
}
