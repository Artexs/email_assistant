import {
  PROFILE_SIGNATURE_MAX,
  PROFILE_STYLE_MAX,
  profileLength,
  styleFromForm,
  type MailboxView,
  type ProfileView,
  type SentTracking,
} from "@ea/core/web";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { getLocale, t } from "../../i18n";
import { isDirty } from "../../lib/draft";
import { errorText } from "../../lib/errors";
import {
  changedBody,
  fieldError,
  loadProfile,
  previewProfile,
  replySwitchBlocked,
  saveProfile,
  serverFieldError,
  valuesOf,
  type FieldError,
  type PreviewAnswer,
  type ProfileValues,
} from "../../lib/reply-style";
import { suggestButton, type SuggestButton } from "../../lib/style-suggest";
import { useDraft } from "../../lib/use-draft";
import { useResource } from "../../lib/use-resource";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";

import { ReplySamples } from "./ReplySamples";
import { StyleGuide } from "./StyleGuide";
import { StyleSuggest } from "./StyleSuggest";

// The anchor that the links of the organization signature card use.
export const STYLE_CARD_ID = "style-card";

type Preview = { state: "idle" } | { state: "running" } | { state: "done"; answer: PreviewAnswer };

interface FormProps {
  mailboxId: string;
  view: ProfileView;
  isOwner: boolean;
  replyDraftsOn: boolean;
  // An OAuth mailbox has no reply drafts yet: the samples answer with a text instead of a button.
  samplesBlocked: boolean;
  // The button "Suggest my style from my sent mail": `hidden` for a member or while a flag is off.
  suggest: SuggestButton;
  onSaved(view: ProfileView): void;
}

export function ReplyStyleForm({
  mailboxId,
  view,
  isOwner,
  replyDraftsOn,
  samplesBlocked,
  suggest,
  onSaved,
}: FormProps) {
  const ids = useId();
  const styleField = useRef<HTMLTextAreaElement>(null);
  const { draft, setValue, reset } = useDraft<ProfileValues>(valuesOf(view));
  const values = draft.value;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: "idle" });
  const running = preview.state === "running";

  const edit = (field: keyof ProfileValues, value: string) => {
    setError(null);
    setValue({ ...values, [field]: value });
  };

  const save = async () => {
    const found = fieldError(values);
    if (found !== null) {
      setError(found);
      return;
    }
    setPending(true);
    try {
      const saved = await saveProfile(mailboxId, changedBody(values, valuesOf(view)));
      reset(valuesOf(saved));
      setError(null);
      toast.success(t("rs_saved_toast"));
      onSaved(saved);
    } catch (failure) {
      const field = serverFieldError(failure);
      if (field === null) toast.error(t(errorText(failure)));
      else setError(field);
    } finally {
      setPending(false);
    }
  };

  const runPreview = async () => {
    const found = fieldError(values);
    if (found !== null) {
      setError(found);
      return;
    }
    setPreview({ state: "running" });
    try {
      setPreview({ state: "done", answer: await previewProfile(mailboxId, values) });
    } catch (failure) {
      setPreview({ state: "done", answer: { kind: "failed", key: errorText(failure) } });
    }
  };

  const errorFor = (field: keyof ProfileValues) => (error?.field === field ? error : null);
  const inUse = (field: "displayName" | "signature", fallback: string) =>
    values[field].trim() === "" && (
      <p id={`${ids}-${field}-use`} className="text-sm text-muted-foreground whitespace-pre-wrap">
        {t("rs_in_use", { text: fallback })}
      </p>
    );
  const message = (field: keyof ProfileValues) => {
    const found = errorFor(field);
    return (
      found !== null && (
        <p id={`${ids}-${field}-error`} role="alert" className="text-sm text-destructive">
          {t(found.key)}
        </p>
      )
    );
  };
  const describedBy = (field: keyof ProfileValues, extra: string[]) =>
    [...extra, ...(errorFor(field) === null ? [] : [`${ids}-${field}-error`])].join(" ") || undefined;

  const showFallback = (field: "displayName" | "signature") => values[field].trim() === "";

  return (
    <CardContent className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("rs_help")}</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-name`}>{t("rs_name_label")}</Label>
        <Input
          id={`${ids}-name`}
          value={values.displayName}
          readOnly={!isOwner}
          disabled={pending}
          aria-invalid={errorFor("displayName") !== null}
          aria-describedby={describedBy("displayName", showFallback("displayName") ? [`${ids}-displayName-use`] : [])}
          onChange={(event) => edit("displayName", event.target.value)}
        />
        {inUse("displayName", view.fallbackName)}
        {message("displayName")}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-signature`}>{t("rs_signature_label")}</Label>
        <Textarea
          id={`${ids}-signature`}
          rows={4}
          value={values.signature}
          readOnly={!isOwner}
          disabled={pending}
          aria-invalid={errorFor("signature") !== null}
          aria-describedby={describedBy("signature", [
            `${ids}-signature-count`,
            ...(showFallback("signature") ? [`${ids}-signature-use`] : []),
          ])}
          onChange={(event) => edit("signature", event.target.value)}
        />
        <p id={`${ids}-signature-count`} className="text-sm text-muted-foreground">
          {t("sig_counter", { count: profileLength("signature", values.signature), max: PROFILE_SIGNATURE_MAX })}
        </p>
        {inUse("signature", view.fallbackSignature)}
        {message("signature")}
      </div>

      {replyDraftsOn && (
        <>
          {isOwner && (
            <StyleGuide
              idPrefix={ids}
              pending={pending}
              onApply={(form) => edit("writingStyle", styleFromForm(form, getLocale()))}
            />
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-style`}>{t("rs_style_label")}</Label>
            <Textarea
              id={`${ids}-style`}
              ref={styleField}
              rows={5}
              value={values.writingStyle}
              readOnly={!isOwner}
              disabled={pending}
              aria-invalid={errorFor("writingStyle") !== null}
              aria-describedby={describedBy("writingStyle", [`${ids}-style-help`, `${ids}-style-count`])}
              onChange={(event) => edit("writingStyle", event.target.value)}
            />
            <p id={`${ids}-style-count`} className="text-sm text-muted-foreground">
              {t("sig_counter", { count: profileLength("writingStyle", values.writingStyle), max: PROFILE_STYLE_MAX })}
            </p>
            <p id={`${ids}-style-help`} className="text-sm text-muted-foreground">
              {t("rs_style_help")}
            </p>
            {message("writingStyle")}
            {suggest.kind !== "hidden" && (
              <StyleSuggest
                mailboxId={mailboxId}
                button={suggest}
                onUse={(text) => {
                  edit("writingStyle", text);
                  styleField.current?.focus();
                }}
              />
            )}
          </div>
        </>
      )}

      {isOwner && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending || !isDirty(draft)} onClick={() => void save()}>
            {t("save")}
          </Button>
          {replyDraftsOn && (
            <Button
              type="button"
              variant="outline"
              disabled={pending || running}
              aria-describedby={`${ids}-preview-help`}
              onClick={() => void runPreview()}
            >
              {t("rs_preview")}
            </Button>
          )}
        </div>
      )}
      {isOwner && replyDraftsOn && (
        <p id={`${ids}-preview-help`} className="text-sm text-muted-foreground">
          {t("rs_preview_help")}
        </p>
      )}

      {isOwner && replyDraftsOn && <ReplySamples mailboxId={mailboxId} blocked={samplesBlocked} />}

      {/* The answer of the preview is text from a model: it shows as plain text, never as markup. */}
      <div aria-live="polite" data-preview={preview.state}>
        {preview.state === "done" && preview.answer.kind === "body" && (
          <div className="flex flex-col gap-1.5 rounded-md border p-3">
            <p className="text-sm font-medium">{t("rs_preview_title")}</p>
            <p data-preview-body="" className="whitespace-pre-wrap text-sm">
              {preview.answer.body}
            </p>
            <p className="text-sm text-muted-foreground">{t("rs_preview_note")}</p>
          </div>
        )}
        {preview.state === "done" && preview.answer.kind === "failed" && (
          <p role="alert" className="text-sm text-destructive">
            {t(preview.answer.key)}
          </p>
        )}
      </div>
    </CardContent>
  );
}

export interface ReplyStyleCardProps {
  mailbox: MailboxView;
  isOwner: boolean;
  // The flag `reply_drafts` of the organization: the writing style, the guided form and Preview exist only while it is on.
  replyDraftsOn: boolean;
  // The flag `style_from_sent` of the organization: the button that suggests a writing style from the sent mail.
  styleFromSentOn: boolean;
  // "Track my sent mail" of this mailbox: the suggestion reads the sent mail that tracking stores.
  sentTracking: SentTracking;
}

// The name, signature and writing style of one mailbox. The name and the signature serve every draft kind; the
// writing style and Preview serve reply drafts. A member sees the texts and cannot change them.
export function ReplyStyleCard({
  mailbox,
  isOwner,
  replyDraftsOn,
  styleFromSentOn,
  sentTracking,
}: ReplyStyleCardProps) {
  const { data, error, loading, reload, mutate } = useResource(() => loadProfile(mailbox.id));
  const card = useRef<HTMLDivElement>(null);
  // A link of the organization signature card ends in `#style-card`: the card loads after the page, so the browser cannot scroll to it.
  const loaded = data !== null;
  useEffect(() => {
    if (loaded && location.hash === `#${STYLE_CARD_ID}`) card.current?.scrollIntoView({ block: "start" });
  }, [loaded]);

  return (
    <Card id={STYLE_CARD_ID} data-card="reply-style" ref={card} className="scroll-mt-4">
      <CardHeader>
        <CardTitle>{t("rs_title")}</CardTitle>
      </CardHeader>
      {data === null ? (
        <CardContent>
          {error === null || loading ? (
            <div aria-busy="true">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p>{t("set_load_error")}</p>
              <Button onClick={reload}>{t("retry")}</Button>
            </div>
          )}
        </CardContent>
      ) : (
        <ReplyStyleForm
          mailboxId={mailbox.id}
          view={data}
          isOwner={isOwner}
          replyDraftsOn={replyDraftsOn}
          samplesBlocked={replySwitchBlocked(mailbox)}
          suggest={suggestButton({
            isOwner,
            replyDraftsOn,
            styleFromSentOn,
            sentTracking,
            oauth: replySwitchBlocked(mailbox),
          })}
          onSaved={mutate}
        />
      )}
    </Card>
  );
}
