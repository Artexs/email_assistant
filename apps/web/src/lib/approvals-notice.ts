import type { TextKey } from "../i18n";

// A line under the page title: `info` is a status (a result or a conflict that the page already handled), `error` is the banner.
export interface Notice {
  tone: "info" | "error";
  key: TextKey;
  reason?: TextKey;
  // The version number of `appr_edit_saved`.
  n?: number;
  // The recipient of an approved send, for `appr_done_sent` and `appr_done_sending`.
  to?: string;
}
