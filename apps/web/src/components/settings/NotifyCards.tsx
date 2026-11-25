import { notifyPatchSchema, notifyViewSchema, reportChannels, type NotifyView, type ReportChannel } from "@ea/core/web";
import { MoonStar, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n";
import { api } from "../../lib/api";
import { canWrite } from "../../lib/can-write";
import { isDirty } from "../../lib/draft";
import { errorText } from "../../lib/errors";
import { useDraft } from "../../lib/use-draft";
import { useResource } from "../../lib/use-resource";
import { useMe } from "../shell/MeProvider";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { NoticeRoutesCard, selectClass } from "./NoticeRoutesCard";

// The own quiet hours and the own report channel. Any member edits their own row only: the server takes
// the user from the session. Each card shows only with its flag (`me.features`); the server refuses a write without it.
const DEFAULT_START = "22:00";
const DEFAULT_END = "07:00";
const channelLabels: Record<ReportChannel, TextKey> = {
  telegram: "notify_channel_telegram",
  mail: "notify_channel_mail",
  both: "notify_channel_both",
};

interface CardProps {
  view: NotifyView;
  onSaved(view: NotifyView): void;
}

// The form always shows two times: the own ones, or the default ones when the member has none.
export function QuietHoursCard({ view, onSaved, timeZone }: CardProps & { timeZone: string }) {
  const { me } = useMe();
  const server = { start: view.quietStart ?? DEFAULT_START, end: view.quietEnd ?? DEFAULT_END };
  const { draft, setValue, reset } = useDraft(server);
  const [pendingSave, setPending] = useState(false);
  const pending = pendingSave || !canWrite(me);
  const [error, setError] = useState<TextKey | null>(null);
  const { start, end } = draft.value;
  const isDefault = view.quietStart === null;

  const send = async (body: { quietStart: string | null; quietEnd: string | null }) => {
    const parsed = notifyPatchSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message;
      setError(
        message === "time_invalid" || message === "quiet_pair" || message === "quiet_too_long"
          ? message
          : "error_generic"
      );
      return;
    }
    setPending(true);
    try {
      const saved = await api("/api/me/notify", notifyViewSchema, { method: "PATCH", body: parsed.data });
      reset({ start: saved.quietStart ?? DEFAULT_START, end: saved.quietEnd ?? DEFAULT_END });
      setError(null);
      toast.success(t("notify_quiet_saved_toast"));
      onSaved(saved);
    } catch (failure) {
      toast.error(t(errorText(failure)));
    } finally {
      setPending(false);
    }
  };

  const edit = (next: { start: string; end: string }) => {
    setError(null);
    setValue(next);
  };

  return (
    <SectionCard
      data-card="quiet-hours"
      icon={MoonStar}
      title={t("notify_quiet_title")}
      lead={t("notify_quiet_help", { timezone: timeZone })}
    >
      <RowList>
        <Row title={t("notify_quiet_start_label")} htmlFor="quiet-start">
          <Input
            id="quiet-start"
            type="time"
            step={60}
            value={start}
            disabled={pending}
            aria-invalid={error !== null}
            className="w-36"
            onChange={(event) => edit({ start: event.target.value, end })}
          />
        </Row>
        <Row title={t("notify_quiet_end_label")} htmlFor="quiet-end">
          <Input
            id="quiet-end"
            type="time"
            step={60}
            value={end}
            disabled={pending}
            aria-invalid={error !== null}
            className="w-36"
            onChange={(event) => edit({ start, end: event.target.value })}
          />
        </Row>
      </RowList>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      {isDefault && <p className="text-sm text-muted-foreground">{t("notify_quiet_default_note")}</p>}
      {start !== "" && start === end && <p className="text-sm text-muted-foreground">{t("notify_quiet_same_note")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || !isDirty(draft)}
          onClick={() => void send({ quietStart: start, quietEnd: end })}
        >
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || isDefault}
          onClick={() => void send({ quietStart: null, quietEnd: null })}
        >
          {t("notify_quiet_use_default")}
        </Button>
      </div>
    </SectionCard>
  );
}

export function ReportChannelCard({ view, onSaved }: CardProps) {
  const { me } = useMe();
  // With `mail` or `both` the form shows the mailbox that the server would take: the stored one, else the oldest.
  const server = { channel: view.reportChannel, mailboxId: view.reportMailboxId ?? view.mailboxes[0]?.id ?? "" };
  const { draft, setValue, reset } = useDraft(server);
  const [pendingSave, setPending] = useState(false);
  const pending = pendingSave || !canWrite(me);
  const { channel, mailboxId } = draft.value;
  const usesMail = channel !== "telegram";
  const noMailbox = usesMail && view.mailboxes.length === 0;

  const save = async () => {
    setPending(true);
    try {
      const body =
        usesMail && mailboxId !== ""
          ? { reportChannel: channel, reportMailboxId: mailboxId }
          : { reportChannel: channel };
      const saved = await api("/api/me/notify", notifyViewSchema, { method: "PATCH", body });
      reset({ channel: saved.reportChannel, mailboxId: saved.reportMailboxId ?? saved.mailboxes[0]?.id ?? "" });
      toast.success(t("notify_channel_saved_toast"));
      onSaved(saved);
    } catch (failure) {
      toast.error(t(errorText(failure)));
    } finally {
      setPending(false);
    }
  };

  return (
    <SectionCard
      data-card="report-channel"
      icon={Send}
      title={t("notify_channel_title")}
      lead={t("notify_channel_help")}
    >
      <RowList>
        <Row title={t("notify_channel_label")} htmlFor="report-channel">
          <select
            id="report-channel"
            value={channel}
            disabled={pending}
            className={selectClass}
            onChange={(event) => setValue({ channel: event.target.value as ReportChannel, mailboxId })}
          >
            {reportChannels.map((value) => (
              <option key={value} value={value}>
                {t(channelLabels[value])}
              </option>
            ))}
          </select>
        </Row>
        {usesMail && view.mailboxes.length > 0 && (
          <Row title={t("notify_mailbox_label")} htmlFor="report-mailbox">
            <select
              id="report-mailbox"
              value={mailboxId}
              disabled={pending}
              className={selectClass}
              onChange={(event) => setValue({ channel, mailboxId: event.target.value })}
            >
              {view.mailboxes.map((mailbox) => (
                <option key={mailbox.id} value={mailbox.id}>
                  {mailbox.address}
                </option>
              ))}
            </select>
          </Row>
        )}
      </RowList>
      {noMailbox && (
        <p role="alert" className="text-sm text-destructive">
          {t("notify_no_mailbox")}
        </p>
      )}
      {channel !== "mail" && !view.telegramLinked && (
        <p className="text-sm text-muted-foreground">{t("notify_telegram_unlinked")}</p>
      )}
      <div>
        <Button type="button" disabled={pending || !isDirty(draft) || noMailbox} onClick={() => void save()}>
          {t("save")}
        </Button>
      </div>
    </SectionCard>
  );
}

// The cards load their data here, and only here: `NotifyCards` is the one place that makes a request.
export function NotifyCards({
  timeZone,
  quiet,
  channel,
  routes,
}: {
  timeZone: string;
  quiet: boolean;
  channel: boolean;
  routes: boolean;
}) {
  const { data, mutate } = useResource(() => api("/api/me/notify", notifyViewSchema));
  if (data === null) return null;
  return (
    <>
      {quiet && <QuietHoursCard view={data} timeZone={timeZone} onSaved={mutate} />}
      {channel && <ReportChannelCard view={data} onSaved={mutate} />}
      {routes && <NoticeRoutesCard view={data} onSaved={mutate} />}
    </>
  );
}

// A card shows only with its flag (`me.features`). With every flag off nothing is mounted, so no request goes out. A function
// of its inputs (no hook), so a test can call it.
export function NotifySection({ features, timeZone }: { features: readonly string[]; timeZone: string }) {
  const quiet = features.includes("user_quiet_hours");
  const channel = features.includes("report_mail");
  const routes = features.includes("web_push");
  return quiet || channel || routes ? (
    <NotifyCards timeZone={timeZone} quiet={quiet} channel={channel} routes={routes} />
  ) : null;
}
