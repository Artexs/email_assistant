import { TriangleAlert } from "lucide-react";
import { Fragment } from "react";

import { t } from "../../i18n";
import { addressText } from "../../lib/replies-view";

// The addresses of a draft, spelled out before a send. An address with letters that can look like others (a lookalike domain) shows
// its domain in punycode and a mark with the reason, so the owner sees it before the tap.
export function AddressList({ entries }: { entries: readonly string[] }) {
  return (
    <>
      {entries.map((entry, index) => {
        const { text, unusual } = addressText(entry);
        return (
          // The same address cannot stand twice in one list; the index keeps the key unique for any stored text.
          <Fragment key={`${index}:${entry}`}>
            {index > 0 && ", "}
            {/* Isolated: a direction override in the text cannot reverse the text around it. */}
            <bdi>{text}</bdi>
            {unusual && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 align-middle text-xs">
                <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
                {t("rp_address_unusual")}
              </span>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
