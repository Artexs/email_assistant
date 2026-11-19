import {
  PROFILE_SIGNATURE_MAX,
  PROFILE_STYLE_MAX,
  profileLength,
  STYLE_FORM_LINE_MAX,
  styleAddressForms,
  styleFromForm,
  styleLengths,
  type MailboxView,
  type ProfileView,
  type StyleForm,
} from "@ea/core/web";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { getLocale, t, type TextKey } from "../../i18n";
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
import { useDraft } from "../../lib/use-draft";
import { useResource } from "../../lib/use-resource";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";

import { ReplySamples } from "./ReplySamples";

// The anchor that the links of the organization signature card use.
export const STYLE_CARD_ID = "style-card";

const selectClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

const addressTexts: Record<StyleForm["address"], TextKey> = {
  formal: "rs_address_formal",
  first_name: "rs_address_first_name",
  mirror: "rs_address_mirror",
};
const lengthTexts: Record<StyleForm["length"], TextKey> = {
  short: "rs_length_short",
  normal: "rs_length_normal",
};

const START_FORM: StyleForm = { address: "formal", greeting: "", signOff: "", length: "normal" };

type Preview = { state: "idle" } | { state: "running" } | { state: "done"; answer: PreviewAnswer };

interface FormProps {
  mailboxId: string;
  view: ProfileView;
  isOwner: boolean;
  replyDraftsOn: boolean;
  // An OAuth mailbox has no reply drafts yet: the samples answer with a text instead of a button.
  samplesBlocked: boolean;
  onSaved(view: ProfileView): void;
}

export function ReplyStyleForm({ mailboxId, view, isOwner, replyDraftsOn, samplesBlocked, onSaved }: FormProps) {
  const ids = useId();
  const { draft, setValue, reset } = useDraft<ProfileValues>(valuesOf(view));
  const values = draft.value;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [form, setForm] = useState<StyleForm>(START_FORM);
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
            <fieldset className="flex flex-col gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{t("rs_form_title")}</legend>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-address`}>{t("rs_form_address")}</Label>
                <select
                  id={`${ids}-address`}
                  value={form.address}
                  disabled={pending}
                  className={selectClass}
                  onChange={(event) => {
                    const picked = styleAddressForms.find((item) => item === event.target.value);
                    if (picked !== undefined) setForm({ ...form, address: picked });
                  }}
                >
                  {styleAddressForms.map((item) => (
                    <option key={item} value={item}>
                      {t(addressTexts[item])}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-greeting`}>{t("rs_form_greeting")}</Label>
                <Input
                  id={`${ids}-greeting`}
                  value={form.greeting}
                  maxLength={STYLE_FORM_LINE_MAX}
                  disabled={pending}
                  onChange={(event) => setForm({ ...form, greeting: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-sign-off`}>{t("rs_form_sign_off")}</Label>
                <Input
                  id={`${ids}-sign-off`}
                  value={form.signOff}
                  maxLength={STYLE_FORM_LINE_MAX}
                  disabled={pending}
                  onChange={(event) => setForm({ ...form, signOff: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-length`}>{t("rs_form_length")}</Label>
                <select
                  id={`${ids}-length`}
                  value={form.length}
                  disabled={pending}
                  className={selectClass}
                  onChange={(event) => {
                    const picked = styleLengths.find((item) => item === event.target.value);
                    if (picked !== undefined) setForm({ ...form, length: picked });
                  }}
                >
                  {styleLengths.map((item) => (
                    <option key={item} value={item}>
                      {t(lengthTexts[item])}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col items-start gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  aria-describedby={`${ids}-apply-help`}
                  onClick={() => edit("writingStyle", styleFromForm(form, getLocale()))}
                >
                  {t("rs_apply")}
                </Button>
                <p id={`${ids}-apply-help`} className="text-sm text-muted-foreground">
                  {t("rs_apply_help")}
                </p>
              </div>
            </fieldset>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-style`}>{t("rs_style_label")}</Label>
            <Textarea
              id={`${ids}-style`}
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
}

// The name, signature and writing style of one mailbox. The name and the signature serve every draft kind; the
// writing style and Preview serve reply drafts. A member sees the texts and cannot change them.
export function ReplyStyleCard({ mailbox, isOwner, replyDraftsOn }: ReplyStyleCardProps) {
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
          onSaved={mutate}
        />
      )}
    </Card>
  );
}
