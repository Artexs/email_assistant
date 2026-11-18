import type { UserLocale } from "../tenancy";
import type { SuspiciousReason } from "../triage/suspicious";

// The warning of a suspicious mail in a notice. Fixed phrases only: no mail text.
export interface SuspiciousTexts {
  // The one line of the warning; `list` is the reason names in `suspiciousReasons` order, joined by ", ".
  line: (list: string) => string;
  reason: Record<SuspiciousReason, string>;
  // Replaces the "would do" line of a flagged `delegation` mail (the mail gets no draft).
  noDraft: string;
}

export const suspiciousTexts = {
  en: {
    line: (list) => `⚠ Suspicious: ${list}`,
    reason: {
      auth_fail: "sender check failed",
      lookalike_domain: "look-alike domain",
      display_name_spoof: "fake sender name",
      reply_to_mismatch: "replies go to another domain",
      link_mismatch: "link goes elsewhere",
      risky_attachment: "risky attachment",
    },
    noDraft: "no draft: suspicious mail",
  },
  pl: {
    line: (list) => `⚠ Podejrzana wiadomość: ${list}`,
    reason: {
      auth_fail: "nadawca nie przeszedł weryfikacji",
      lookalike_domain: "domena podobna do znanej",
      display_name_spoof: "fałszywa nazwa nadawcy",
      reply_to_mismatch: "odpowiedzi idą do innej domeny",
      link_mismatch: "link prowadzi gdzie indziej",
      risky_attachment: "ryzykowny załącznik",
    },
    noDraft: "bez szkicu: podejrzana wiadomość",
  },
} satisfies Record<UserLocale, SuspiciousTexts>;
