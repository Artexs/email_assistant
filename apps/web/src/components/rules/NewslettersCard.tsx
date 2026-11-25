import {
  formatClock,
  newsletterListSchema,
  unsubscribeResultSchema,
  type MailboxView,
  type NewsletterItem,
} from "@ea/core/web";
import { Newspaper } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { getLocale, t, tp } from "../../i18n";
import { api } from "../../lib/api";
import { actionOf, newslettersPath, unsubscribeFailureKey, unsubscribePath } from "../../lib/newsletters-view";
import { useNow } from "../../lib/use-now";
import { useResource } from "../../lib/use-resource";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";

// The identity of a row is the sender address. The display name is mail text: it shows as plain text, small, after the address.
function RequestState({ item, hasLink }: { item: NewsletterItem; hasLink: boolean }) {
  const status = item.request?.status;
  if (status === undefined) return null;
  const code = item.request?.code ?? null;
  const text =
    status === "requested"
      ? t("nl_requested")
      : status === "done"
        ? t("nl_done")
        : status === "refused"
          ? t("nl_refused")
          : t(hasLink ? "nl_failed_open" : "nl_failed");
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge
        role="status"
        variant={status === "done" ? "default" : status === "requested" ? "secondary" : "destructive"}
      >
        {text}
      </Badge>
      {code !== null && status !== "requested" && <span>{t("nl_code", { code })}</span>}
    </span>
  );
}

interface TapProps {
  mailboxId: string;
  canTap: boolean;
  onChanged(): void;
}

// The tap: one POST. A second tap cannot happen: the button is gone once the row has a request, and the server refuses it anyway.
function UnsubscribeButton({ item, mailboxId, onChanged }: { item: NewsletterItem } & Omit<TapProps, "canTap">) {
  const [pending, setPending] = useState(false);
  async function tap() {
    setPending(true);
    try {
      await api(unsubscribePath(mailboxId), unsubscribeResultSchema, {
        method: "POST",
        body: { sender: item.senderLower },
      });
    } catch (failure) {
      const key = unsubscribeFailureKey(failure);
      if (key !== null) toast.error(t(key));
    } finally {
      setPending(false);
      onChanged();
    }
  }
  return (
    <Button
      size="sm"
      variant="soft"
      disabled={pending}
      aria-label={t("nl_unsubscribe_for", { sender: item.senderLower })}
      onClick={tap}
    >
      {t(pending ? "nl_sending" : "nl_unsubscribe")}
    </Button>
  );
}

function NewsletterRow({
  item,
  timeZone,
  now,
  tap,
}: {
  item: NewsletterItem;
  timeZone: string;
  now: Date;
  tap: TapProps;
}) {
  const action = actionOf(item, tap.canTap);
  const hasState = item.request !== null;
  return (
    <div className="contents break-words" data-sender={item.senderLower} data-method={item.method}>
      <Row
        title={item.senderLower}
        controlBelow
        hint={
          <>
            {item.fromName !== null && item.fromName !== "" && <span className="block truncate">{item.fromName}</span>}
            <span className="block">
              {tp("nl_count", item.count)} ·{" "}
              {t("nl_latest", { time: formatClock(new Date(item.latestAt), timeZone, now, getLocale()) })}
            </span>
            {(hasState || action.kind === "open" || action.kind === "none") && (
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <RequestState item={item} hasLink={action.kind === "open"} />
                {action.kind === "open" && <span>{action.host}</span>}
                {action.kind === "none" && <span>{t("nl_none")}</span>}
              </span>
            )}
          </>
        }
      >
        {action.kind === "open" && (
          <Button asChild size="sm" variant="soft">
            <a
              href={action.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("nl_open_link_for", { sender: item.senderLower })}
            >
              {t("nl_open_link")}
            </a>
          </Button>
        )}
        {action.kind === "unsubscribe" && (
          <UnsubscribeButton item={item} mailboxId={tap.mailboxId} onChanged={tap.onChanged} />
        )}
      </Row>
    </div>
  );
}

function MailboxNewsletters({
  mailbox,
  timeZone,
  canTap,
}: {
  mailbox: MailboxView;
  timeZone: string;
  canTap: boolean;
}) {
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
  return (
    <NewsletterRows
      senders={data.senders}
      timeZone={timeZone}
      now={now}
      mailboxId={mailbox.id}
      canTap={canTap}
      onChanged={reload}
    />
  );
}

export interface NewsletterRowsProps {
  senders: NewsletterItem[];
  timeZone: string;
  now: Date;
  /** The owner of an account that can write may tap; the default is no button. */
  canTap?: boolean;
  mailboxId?: string;
  onChanged?: () => void;
}

export function NewsletterRows({
  senders,
  timeZone,
  now,
  canTap = false,
  mailboxId = "",
  onChanged,
}: NewsletterRowsProps) {
  const tap: TapProps = { mailboxId, canTap, onChanged: onChanged ?? (() => undefined) };
  if (senders.length === 0) return <p className="text-sm text-muted-foreground">{t("nl_empty")}</p>;
  return (
    <RowList>
      {senders.map((item) => (
        <NewsletterRow key={item.senderLower} item={item} timeZone={timeZone} now={now} tap={tap} />
      ))}
    </RowList>
  );
}

export interface NewslettersCardProps {
  mailboxes: MailboxView[];
  timeZone: string;
  /** An owner of an account that can write (not paused). A member sees the list and no button. */
  isOwner: boolean;
}

export function NewslettersCard({ mailboxes, timeZone, isOwner }: NewslettersCardProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  // Derived in render: a mailbox that left the list falls back to the first one.
  const mailbox = mailboxes.find((item) => item.id === chosen) ?? mailboxes[0];
  if (mailbox === undefined) return null;

  return (
    <SectionCard icon={Newspaper} title={t("nl_title")} lead={t("nl_help")} data-card="newsletters">
      {isOwner && <p className="text-sm text-muted-foreground">{t("nl_one_click_help")}</p>}
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
      <MailboxNewsletters key={mailbox.id} mailbox={mailbox} timeZone={timeZone} canTap={isOwner} />
    </SectionCard>
  );
}
