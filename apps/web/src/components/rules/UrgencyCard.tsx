import { settingsViewSchema, type MailboxView, type SettingsWebView, type UrgencyProfile } from "@ea/core/web";
import { Flame, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { t } from "../../i18n";
import { api, ApiError } from "../../lib/api";
import { isDirty } from "../../lib/draft";
import { errorText } from "../../lib/errors";
import { settingsPath } from "../../lib/settings-api";
import {
  canAddDeadline,
  canAddTopic,
  draftFromProfile,
  isEnded,
  profileFromDraft,
  type UrgencyDraft,
  type UrgencyError,
} from "../../lib/urgency-form";
import { useDraft } from "../../lib/use-draft";
import { useNow } from "../../lib/use-now";
import { useResource } from "../../lib/use-resource";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { SectionCard } from "../patterns/SectionCard";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { UrgencyReadOnly, VipLine } from "./UrgencyReadOnly";

interface FormProps {
  settings: SettingsWebView;
  address: string;
  isOwner: boolean;
  timeZone: string;
  onSaved(settings: SettingsWebView): void;
  onMissing(): void;
}

export function UrgencyForm({ settings, address, isOwner, timeZone, onSaved, onMissing }: FormProps) {
  const now = useNow();
  const { draft, setValue, reset } = useDraft<UrgencyDraft>(draftFromProfile(settings.urgencyProfile));
  const [error, setError] = useState<UrgencyError | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // After "Clear all" the Clear button unmounts: the focus goes to the Add button, which stays. After Cancel it goes back to Clear.
  const focusAddAfterClose = useRef(false);
  // The id of the element that takes the focus after the next render (a new row, or the add button after a removal).
  const [focusId, setFocusId] = useState<string | null>(null);
  const value = draft.value;

  useEffect(() => {
    if (focusId === null) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const send = async (profile: UrgencyProfile | null, toastKey: "urg_saved_toast" | "urg_cleared_toast") => {
    setPending(true);
    try {
      const view = await api(settingsPath(settings.mailboxId, "/urgency"), settingsViewSchema, {
        method: "PUT",
        body: { profile },
      });
      reset(draftFromProfile(view.urgencyProfile));
      setError(null);
      toast.success(t(toastKey));
      onSaved(view);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) {
        toast.error(t("err_not_found"));
        onMissing();
      } else {
        toast.error(t(errorText(failure)));
      }
    } finally {
      setPending(false);
    }
  };

  const save = async () => {
    const result = profileFromDraft(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await send(result.profile, "urg_saved_toast");
  };

  const clearAll = async () => {
    focusAddAfterClose.current = true;
    setConfirmOpen(false);
    await send(null, "urg_cleared_toast");
  };

  const change = (next: UrgencyDraft) => {
    setError(null);
    setValue(next);
  };

  const editTopic = (index: number, patch: Partial<UrgencyDraft["topics"][number]>) =>
    change({ ...value, topics: value.topics.map((item, at) => (at === index ? { ...item, ...patch } : item)) });
  const editDeadline = (index: number, patch: Partial<UrgencyDraft["deadlines"][number]>) =>
    change({ ...value, deadlines: value.deadlines.map((item, at) => (at === index ? { ...item, ...patch } : item)) });

  if (!isOwner) return <UrgencyReadOnly settings={settings} timeZone={timeZone} now={now} />;

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section aria-labelledby="urg-topics-title" className="flex flex-col gap-3">
        <div>
          <h3 id="urg-topics-title" className="text-base font-bold">
            {t("urg_topics_title")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("urg_topics_help")}</p>
        </div>
        {value.topics.length === 0 && <p className="text-sm text-muted-foreground">{t("urg_topics_empty")}</p>}
        {value.topics.length > 0 && (
          <RowList>
            {value.topics.map((topic, index) => (
              <Row
                key={index}
                title={t("urg_topic_row", { n: index + 1 })}
                hint={
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id={`urg-topic-name-${index}`}
                      className="sm:flex-1"
                      autoComplete="off"
                      aria-label={t("urg_topic_name_label", { n: index + 1 })}
                      aria-invalid={error?.key.startsWith("urg_err_topic") === true && error.n === index + 1}
                      value={topic.label}
                      onChange={(event) => editTopic(index, { label: event.target.value })}
                    />
                    <Input
                      className="sm:flex-1"
                      autoComplete="off"
                      aria-label={t("urg_topic_keywords_label", { n: index + 1 })}
                      aria-invalid={error?.key.startsWith("urg_err_keyword") === true && error.n === index + 1}
                      value={topic.keywords}
                      onChange={(event) => editTopic(index, { keywords: event.target.value })}
                    />
                  </div>
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("urg_topic_remove", { n: index + 1 })}
                  onClick={() => {
                    change({ ...value, topics: value.topics.filter((_, at) => at !== index) });
                    setFocusId("urg-topic-add");
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </Row>
            ))}
          </RowList>
        )}
        <div>
          <Button
            id="urg-topic-add"
            type="button"
            variant="soft"
            disabled={!canAddTopic(value)}
            onClick={() => {
              change({ ...value, topics: [...value.topics, { label: "", keywords: "" }] });
              setFocusId(`urg-topic-name-${value.topics.length}`);
            }}
          >
            {t("urg_topic_add")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="urg-deadlines-title" className="flex flex-col gap-3">
        <div>
          <h3 id="urg-deadlines-title" className="text-base font-bold">
            {t("urg_deadlines_title")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("urg_deadlines_help")}</p>
        </div>
        {value.deadlines.length === 0 && <p className="text-sm text-muted-foreground">{t("urg_deadlines_empty")}</p>}
        {value.deadlines.length > 0 && (
          <RowList>
            {value.deadlines.map((deadline, index) => {
              const ended = isEnded(deadline.due, now, timeZone);
              return (
                <div key={index} data-ended={ended ? "true" : undefined}>
                  <Row
                    title={t("urg_deadline_row", { n: index + 1 })}
                    hint={
                      <>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            id={`urg-deadline-name-${index}`}
                            className={`sm:flex-1 ${ended ? "line-through" : ""}`}
                            autoComplete="off"
                            aria-label={t("urg_deadline_name_label", { n: index + 1 })}
                            aria-invalid={error?.key === "urg_err_deadline_label" && error.n === index + 1}
                            value={deadline.label}
                            onChange={(event) => editDeadline(index, { label: event.target.value })}
                          />
                          <Input
                            type="date"
                            className={`sm:w-auto ${ended ? "line-through" : ""}`}
                            aria-label={t("urg_deadline_date_label", { n: index + 1 })}
                            aria-invalid={error?.key === "urg_err_deadline_date" && error.n === index + 1}
                            value={deadline.due}
                            onChange={(event) => editDeadline(index, { due: event.target.value })}
                          />
                        </div>
                        {ended && <p className="mt-1.5">{t("urg_ended")}</p>}
                      </>
                    }
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("urg_deadline_remove", { n: index + 1 })}
                      onClick={() => {
                        change({ ...value, deadlines: value.deadlines.filter((_, at) => at !== index) });
                        setFocusId("urg-deadline-add");
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </Row>
                </div>
              );
            })}
          </RowList>
        )}
        <div>
          <Button
            id="urg-deadline-add"
            type="button"
            variant="soft"
            disabled={!canAddDeadline(value)}
            onClick={() => {
              change({ ...value, deadlines: [...value.deadlines, { label: "", due: "" }] });
              setFocusId(`urg-deadline-name-${value.deadlines.length}`);
            }}
          >
            {t("urg_deadline_add")}
          </Button>
        </div>
      </section>

      <VipLine />

      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {t(error.key, { n: error.n })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !isDirty(draft)}>
          {t("save")}
        </Button>
        {settings.urgencyProfile !== null && (
          <Button
            id="urg-clear"
            type="button"
            variant="destructive-soft"
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
          >
            {t("urg_clear")}
          </Button>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => !pending && setConfirmOpen(open)}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            // The dialog has no trigger element, so the default would leave the focus on the page body.
            const cleared = focusAddAfterClose.current;
            focusAddAfterClose.current = false;
            event.preventDefault();
            document.getElementById(cleared ? "urg-topic-add" : "urg-clear")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("urg_clear_title")}</DialogTitle>
            <DialogDescription>{t("urg_clear_text", { address })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={() => void clearAll()}>
              {t("urg_clear")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

export interface UrgencyCardProps {
  mailboxes: MailboxView[];
  isOwner: boolean;
  timeZone: string;
  reloadMailboxes(): void;
}

function MailboxUrgency({
  mailbox,
  isOwner,
  timeZone,
  reloadMailboxes,
}: {
  mailbox: MailboxView;
  isOwner: boolean;
  timeZone: string;
  reloadMailboxes(): void;
}) {
  const { data, error, loading, reload, mutate } = useResource(() => api(settingsPath(mailbox.id), settingsViewSchema));
  if (data === null) {
    return error === null || loading ? (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <p>{t("set_load_error")}</p>
        <Button onClick={reload}>{t("retry")}</Button>
      </div>
    );
  }
  return (
    <UrgencyForm
      settings={data}
      address={mailbox.address}
      isOwner={isOwner}
      timeZone={timeZone}
      onSaved={mutate}
      onMissing={reloadMailboxes}
    />
  );
}

export function UrgencyCard({ mailboxes, isOwner, timeZone, reloadMailboxes }: UrgencyCardProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  // Derived in render: a mailbox that left the list falls back to the first one.
  const mailbox = mailboxes.find((item) => item.id === chosen) ?? mailboxes[0];
  if (mailbox === undefined) return null;

  return (
    <SectionCard data-card="urgency" icon={Flame} title={t("urg_title")} lead={t("urg_help")}>
      <div className="flex flex-col gap-4">
        {mailboxes.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="urgency-mailbox">{t("urg_mailbox_label")}</Label>
            <Select value={mailbox.id} onValueChange={setChosen}>
              <SelectTrigger id="urgency-mailbox" className="w-full">
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
        <MailboxUrgency
          key={mailbox.id}
          mailbox={mailbox}
          isOwner={isOwner}
          timeZone={timeZone}
          reloadMailboxes={reloadMailboxes}
        />
      </div>
    </SectionCard>
  );
}
