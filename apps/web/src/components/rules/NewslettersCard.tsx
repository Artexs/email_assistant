import { formatClock, newsletterListSchema, type MailboxView, type NewsletterItem } from "@ea/core/web";
import { useState } from "react";

import { getLocale, t, tp } from "../../i18n";
import { api } from "../../lib/api";
import { actionOf, newslettersPath } from "../../lib/newsletters-view";
import { useNow } from "../../lib/use-now";
import { useResource } from "../../lib/use-resource";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";

// The identity of a row is the sender address. The display name is mail text: it shows as plain text, small, after the address.
function RequestState({ item, hasLink }: { item: NewsletterItem; hasLink: boolean }) {
  const status = item.request?.status;
  if (status === undefined) return null;
  if (status === "requested") return <span>{t("nl_requested")}</span>;
  if (status === "done") return <span>{t("nl_done")}</span>;
  return <span>{t(hasLink ? "nl_failed_open" : "nl_failed")}</span>;
}

function Row({ item, timeZone, now }: { item: NewsletterItem; timeZone: string; now: Date }) {
  const action = actionOf(item);
  return (
    <li className="flex flex-col gap-1 py-3" data-sender={item.senderLower} data-method={item.method}>
      <span className="break-all font-medium">{item.senderLower}</span>
      {item.fromName !== null && item.fromName !== "" && (
        <span className="truncate text-sm text-muted-foreground">{item.fromName}</span>
      )}
      <span className="text-sm text-muted-foreground">
        {tp("nl_count", item.count)} ·{" "}
        {t("nl_latest", { time: formatClock(new Date(item.latestAt), timeZone, now, getLocale()) })}
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <RequestState item={item} hasLink={action.kind === "open"} />
        {action.kind === "open" && (
          <>
            <a
              className="underline"
              href={action.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("nl_open_link_for", { sender: item.senderLower })}
            >
              {t("nl_open_link")}
            </a>
            <span className="text-muted-foreground">{action.host}</span>
          </>
        )}
        {action.kind === "none" && <span className="text-muted-foreground">{t("nl_none")}</span>}
        {/* One-click rows get their button from F110 stage 24. */}
      </div>
    </li>
  );
}

function MailboxNewsletters({ mailbox, timeZone }: { mailbox: MailboxView; timeZone: string }) {
  const now = useNow();
  const { data, error, loading, reload } = useResource(() => api(newslettersPath(mailbox.id), newsletterListSchema));
  if (data === null) {
    return error === null || loading ? (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <p>{t("nl_load_error")}</p>
        <Button onClick={reload}>{t("retry")}</Button>
      </div>
    );
  }
  return <NewsletterRows senders={data.senders} timeZone={timeZone} now={now} />;
}

export function NewsletterRows({ senders, timeZone, now }: { senders: NewsletterItem[]; timeZone: string; now: Date }) {
  if (senders.length === 0) return <p className="text-sm text-muted-foreground">{t("nl_empty")}</p>;
  return (
    <ul className="flex flex-col divide-y">
      {senders.map((item) => (
        <Row key={item.senderLower} item={item} timeZone={timeZone} now={now} />
      ))}
    </ul>
  );
}

export interface NewslettersCardProps {
  mailboxes: MailboxView[];
  timeZone: string;
}

export function NewslettersCard({ mailboxes, timeZone }: NewslettersCardProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  // Derived in render: a mailbox that left the list falls back to the first one.
  const mailbox = mailboxes.find((item) => item.id === chosen) ?? mailboxes[0];
  if (mailbox === undefined) return null;

  return (
    <Card data-card="newsletters">
      <CardHeader>
        <CardTitle>{t("nl_title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("nl_help")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mailboxes.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newsletters-mailbox">{t("nl_mailbox_label")}</Label>
            <Select value={mailbox.id} onValueChange={setChosen}>
              <SelectTrigger id="newsletters-mailbox" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mailboxes.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <MailboxNewsletters key={mailbox.id} mailbox={mailbox} timeZone={timeZone} />
      </CardContent>
    </Card>
  );
}
