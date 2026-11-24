import { categories } from "@ea/core";

import { CategoryPill } from "../../components/patterns/CategoryPill";
import type { PatternSection } from "../sections";

const LABELS = {
  urgent: "Urgent",
  needs_reply: "Needs reply",
  delegation: "Delegation",
  info: "Info",
  notification: "Notification",
  spam: "Spam",
  unsure: "Unsure",
} as const;

export const section: PatternSection = {
  title: "CategoryPill",
  order: 20,
  render: () => (
    <div className="flex flex-wrap gap-3">
      {categories.map((category) => (
        <CategoryPill key={category} category={category} label={LABELS[category]} />
      ))}
    </div>
  ),
};
