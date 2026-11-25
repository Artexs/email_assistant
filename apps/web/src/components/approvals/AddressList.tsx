import { TriangleAlert } from "lucide-react";
import { Fragment } from "react";

import { t } from "../../i18n";
import { addressText } from "../../lib/replies-view";
import { Badge } from "../ui/badge";

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
              <Badge variant="destructive" className="ml-2 max-w-full whitespace-normal text-left align-middle">
                <TriangleAlert aria-hidden="true" />
                {t("rp_address_unusual")}
              </Badge>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
