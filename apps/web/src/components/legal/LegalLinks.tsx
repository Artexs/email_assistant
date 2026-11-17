import { t, useLocale, type TextKey } from "../../i18n";
import { legalPath, type LegalDoc } from "../../lib/legal";

// The order of the links: the terms first, as the sign-in reader meets them.
const linkOrder: readonly LegalDoc[] = ["terms", "privacy", "dpa"];

const titleKeys: Record<LegalDoc, TextKey> = {
  terms: "legal_terms_title",
  privacy: "legal_privacy_title",
  dpa: "legal_dpa_title",
};

// The three legal documents in the panel language (P4). The sign-in page opens them in the same tab; the Account card
// opens them in a new tab, so a member keeps the page.
export function LegalLinks({ newTab = false, className }: { newTab?: boolean; className?: string }) {
  const lang = useLocale();
  return (
    <nav aria-label={t("docs_links_label")} data-nav="legal">
      <ul className={className ?? "flex flex-wrap gap-x-4 gap-y-1 text-sm"}>
        {linkOrder.map((doc) => (
          <li key={doc}>
            <a
              href={legalPath(lang, doc)}
              {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="underline"
            >
              {t(titleKeys[doc])}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
