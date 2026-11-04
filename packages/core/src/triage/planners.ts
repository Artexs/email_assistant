import type { Category } from "./categories";

// S3/S4 add more types with their own migration.
export const actionTypes = ["move", "mark_read", "flag", "save_summary"] as const;
export type ActionType = (typeof actionTypes)[number];

// The keys of `AI_FOLDERS` in `apps/server/src/modules/mail/connect.ts`. The committer turns a key into a folder
// name through `mailboxes.folder_map`.
export const folderKeys = ["ai_info", "ai_notifications", "ai_spam", "ai_manual"] as const;
export type FolderKey = (typeof folderKeys)[number];

// Payloads hold only folder keys and the summary: never an address, a recipient or a folder name from the LLM.
export type PlannedAction =
  | { type: "move"; folder: FolderKey }
  | { type: "mark_read" }
  | { type: "flag" }
  | { type: "save_summary"; summary: string };

// The plan in `assist` mode (architecture §4.2). The caller marks the summary with `markUntrustedText` first.
export function planActions(category: Category, summary: string | null): PlannedAction[] {
  switch (category) {
    case "urgent":
      return [{ type: "flag" }];
    case "needs_reply":
      return [];
    case "info":
      return [
        { type: "save_summary", summary: summary ?? "" },
        { type: "move", folder: "ai_info" },
      ];
    case "notification":
      return [{ type: "mark_read" }, { type: "move", folder: "ai_notifications" }];
    case "spam":
      return [{ type: "move", folder: "ai_spam" }];
    case "unsure":
      return [{ type: "move", folder: "ai_manual" }];
    case "delegation":
      throw new Error("no planner for delegation before S4");
    default: {
      const unknown: never = category;
      throw new Error(`unknown category: ${String(unknown)}`);
    }
  }
}
