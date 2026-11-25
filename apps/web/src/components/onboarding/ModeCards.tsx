import { mailboxListSchema, settingsViewSchema, type MailboxView, type SettingsWebView } from "@ea/core/web";
import { Eye, Sparkles, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { t, type TextKey } from "../../i18n";
import { api, ApiError } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { settingsPath } from "../../lib/settings-api";
import { useModeChange } from "../../lib/use-mode-change";
import { useResource } from "../../lib/use-resource";
import { AssistDialog } from "../settings/AssistDialog";
import { Button, buttonVariants } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

// A card is narrow on a phone: its button text may wrap instead of widening the page.
const WRAPPING = "h-auto min-h-12 self-start text-center whitespace-normal";

function ModeCardFrame({
  icon: Icon,
  name,
  text,
  children,
}: {
  icon: LucideIcon;
  name: TextKey;
  text: TextKey;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-4" data-mode-card={name}>
      <div className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-2 font-bold">
          <Icon aria-hidden="true" className="size-5 text-primary" />
          {t(name)}
        </h3>
        <p className="text-sm text-muted-foreground">{t(text)}</p>
      </div>
      {children}
    </div>
  );
}

// The Assist button for one mailbox: it loads the settings, then opens the same dialog as Settings and calls the same mode change.
function AssistOne({
  mailbox,
  blocked,
  onMissing,
  onChanged,
}: {
  mailbox: MailboxView;
  blocked: boolean;
  onMissing(): void;
  onChanged(): void;
}) {
  const [loading, setLoading] = useState(false);
  const [switches, setSwitches] = useState<SettingsWebView["toolSwitches"] | null>(null);

  const fail = (error: unknown) => {
    toast.error(t(errorText(error)));
    if (error instanceof ApiError && error.status === 404) onMissing();
  };

  const { pending, change } = useModeChange(mailbox.id, {
    onChanged: () => {
      setSwitches(null);
      toast.success(t("mode_assist_toast"));
      onChanged();
    },
    onFail: fail,
  });

  const open = async () => {
    setLoading(true);
    try {
      const settings = await api(settingsPath(mailbox.id), settingsViewSchema);
      setSwitches(settings.toolSwitches);
    } catch (error) {
      fail(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button className={WRAPPING} disabled={blocked || loading || pending} onClick={() => void open()}>
        {t("ob_use_assist")}
      </Button>
      {switches !== null && (
        <AssistDialog
          mailbox={mailbox}
          switches={switches}
          open
          onOpenChange={(next) => !next && setSwitches(null)}
          onChoose={(keepSwitches) => void change("assist", keepSwitches)}
          pending={pending}
        />
      )}
    </>
  );
}

function AssistAction({ blocked, onChanged }: { blocked: boolean; onChanged(): void }) {
  const mailboxes = useResource(() => api("/api/mailboxes", mailboxListSchema), { pollMs: 0 });
  const list = mailboxes.data;
  if (list === null) {
    if (mailboxes.error === null || mailboxes.loading) return <Skeleton aria-busy="true" className="h-12 w-40" />;
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">{t(errorText(mailboxes.error))}</p>
        <Button variant="outline" onClick={mailboxes.reload}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  const [only] = list;
  if (only === undefined) return <p className="text-sm text-muted-foreground">{t("ob_mode_need_mailbox")}</p>;
  if (list.length > 1) {
    return (
      <a href="/settings" className={`${buttonVariants()} ${WRAPPING}`}>
        {t("ob_assist_settings")}
      </a>
    );
  }
  return <AssistOne mailbox={only} blocked={blocked} onMissing={mailboxes.reload} onChanged={onChanged} />;
}

// The two modes of the open mode step. A card explains; only an owner who can write sees a button, and each button does what
// Settings does: Shadow keeps the mode, Assist opens the mode dialog.
export function ModeCards({ canAct, onDone }: { canAct: boolean; onDone(): void }) {
  const [keeping, setKeeping] = useState(false);

  const keepShadow = async () => {
    setKeeping(true);
    try {
      await api("/api/onboarding/keep-mode", z.undefined(), { method: "POST" });
      onDone();
    } catch (error) {
      toast.error(t(errorText(error)));
    } finally {
      setKeeping(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ModeCardFrame icon={Eye} name="mode_shadow" text="mode_shadow_text">
        {canAct && (
          <Button className={WRAPPING} variant="outline" disabled={keeping} onClick={() => void keepShadow()}>
            {t("ob_keep_shadow")}
          </Button>
        )}
      </ModeCardFrame>
      <ModeCardFrame icon={Sparkles} name="mode_assist" text="mode_assist_text">
        {canAct && <AssistAction blocked={keeping} onChanged={onDone} />}
      </ModeCardFrame>
    </div>
  );
}
