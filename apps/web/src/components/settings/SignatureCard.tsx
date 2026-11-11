import {
  normalizeStyleText,
  organizationViewSchema,
  styleTextSchema,
  type OrganizationSettings,
  type OrganizationView,
} from "@ea/core/web";
import { useState } from "react";
import { toast } from "sonner";

import { t, type TextKey } from "../../i18n/en";
import { api } from "../../lib/api";
import { isDirty } from "../../lib/draft";
import { errorText } from "../../lib/errors";
import { useDraft } from "../../lib/use-draft";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

const styleErrors: readonly TextKey[] = ["style_too_long", "style_bad_char"];

export interface SignatureCardProps {
  organization: OrganizationSettings;
  isOwner: boolean;
  onSaved(view: OrganizationView): void;
}

export function SignatureCard({ organization, isOwner, onSaved }: SignatureCardProps) {
  const { draft, setValue, reset } = useDraft(organization.styleText ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TextKey | null>(null);
  const value = draft.value;

  const save = async () => {
    const parsed = styleTextSchema.safeParse(value);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message;
      setError(styleErrors.find((key) => key === message) ?? "error_generic");
      return;
    }
    setPending(true);
    try {
      const view = await api("/api/organization", organizationViewSchema, {
        method: "PATCH",
        body: { styleText: value },
      });
      reset(view.styleText ?? "");
      setError(null);
      toast.success(t("sig_saved_toast"));
      onSaved(view);
    } catch (failure) {
      toast.error(t(errorText(failure)));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card data-card="signature">
      <CardHeader>
        <CardTitle>{t("sig_title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("sig_help")}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signature">{t("sig_label")}</Label>
          <Textarea
            id="signature"
            rows={4}
            value={value}
            readOnly={!isOwner}
            aria-invalid={error !== null}
            onChange={(event) => {
              setError(null);
              setValue(event.target.value);
            }}
          />
          <p className="text-sm text-muted-foreground">
            {t("sig_counter", { count: normalizeStyleText(value).length })}
          </p>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          )}
        </div>
        {isOwner && (
          <div>
            <Button type="button" disabled={pending || !isDirty(draft)} onClick={() => void save()}>
              {t("save")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
