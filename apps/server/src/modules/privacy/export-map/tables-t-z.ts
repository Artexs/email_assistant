import { byOrg, type ExportTable } from "./kinds";

export const tablesTZ: Record<string, ExportTable> = {
  triage_feedback: byOrg("id", "org_id", "email_id", "verdict", "true_category", "source", "user_id", "created_at"),
  triage_results: byOrg(
    "id",
    "org_id",
    "email_id",
    "category",
    "vip",
    "confidence",
    "reason_code",
    "suspicious_reasons",
    "reason",
    "fields",
    "model",
    "prompt_version",
    "tokens_in",
    "tokens_out",
    "latency_ms",
    "created_at"
  ),
  // A request to unsubscribe from a sender: the sender address, its domain and the result code of the request.
  unsubscribe_requests: byOrg(
    "id",
    "org_id",
    "mailbox_id",
    "sender_lower",
    "sender_domain",
    "method",
    "status",
    "code",
    "created_at",
    "finished_at"
  ),
  // The allow-list. Better Auth keeps `email_verified`, `image` and `updated_at` for itself; the owner knows the rest.
  users: {
    export: true,
    via: "members",
    columns: [
      "id",
      "email",
      "display_name",
      "locale",
      "terms_version",
      "terms_accepted_at",
      "two_factor_enabled",
      "created_at",
    ],
    excluded: {
      email_verified: "not needed",
      image: "not needed",
      updated_at: "not needed",
    },
  },
};
