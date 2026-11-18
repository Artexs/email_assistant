import type { MailboxView, OrganizationSettings } from "@ea/core/web";

import { t } from "../../i18n";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

import { STYLE_CARD_ID } from "./ReplyStyleCard";

export interface SignatureCardProps {
  organization: OrganizationSettings;
  mailboxes: readonly MailboxView[];
}

// The signature of the organization, read-only since F115 stage 11: each mailbox has its own signature (the style card). The old text
// still stands in for a mailbox with no signature of its own, until E6b drops it. The panel calls no write of it any more.
export function SignatureCard({ organization, mailboxes }: SignatureCardProps) {
  const old = organization.styleText?.trim() ?? "";
  return (
    <Card data-card="signature">
      <CardHeader>
        <CardTitle>{t("sig_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("rs_org_note")}</p>
        {old !== "" && (
          <>
            <p data-old-text="" className="whitespace-pre-wrap rounded-md border p-3 text-sm">
              {old}
            </p>
            <p className="text-sm text-muted-foreground">{t("rs_org_old")}</p>
          </>
        )}
        {mailboxes.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {mailboxes.map((mailbox) => (
              <li key={mailbox.id}>
                <a
                  className="underline underline-offset-4"
                  href={`/settings?mailbox=${encodeURIComponent(mailbox.id)}#${STYLE_CARD_ID}`}
                >
                  {t("rs_org_link", { address: mailbox.address })}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
