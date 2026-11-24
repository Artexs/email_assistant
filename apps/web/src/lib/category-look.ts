import type { Category } from "@ea/core";
import { AlertTriangle, Ban, Bell, HelpCircle, Info, Reply, Users, type LucideIcon } from "lucide-react";

// One look per mail category: an icon and the pill colours (the category colour as text on its soft token). `tone` holds whole class
// names, written out in full so the build keeps them.
export const categoryLook: Record<Category, { icon: LucideIcon; tone: string }> = {
  urgent: { icon: AlertTriangle, tone: "bg-cat-urgent-soft text-cat-urgent" },
  needs_reply: { icon: Reply, tone: "bg-cat-needs-reply-soft text-cat-needs-reply" },
  delegation: { icon: Users, tone: "bg-cat-delegation-soft text-cat-delegation" },
  info: { icon: Info, tone: "bg-cat-info-soft text-cat-info" },
  notification: { icon: Bell, tone: "bg-cat-notification-soft text-cat-notification" },
  spam: { icon: Ban, tone: "bg-cat-spam-soft text-cat-spam" },
  unsure: { icon: HelpCircle, tone: "bg-cat-unsure-soft text-cat-unsure" },
};
