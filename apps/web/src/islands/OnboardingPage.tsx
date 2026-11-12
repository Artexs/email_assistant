import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ChecklistItem } from "../components/onboarding/ChecklistItem";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { TelegramLink } from "../components/telegram/TelegramLink";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import { t } from "../i18n/en";
import { api } from "../lib/api";
import { canWrite } from "../lib/can-write";
import { errorText } from "../lib/errors";

function Onboarding() {
  const { me, reload } = useMe();
  const [pending, setPending] = useState(false);

  if (me === null) return null;
  const { onboarding } = me;
  // `isOwnerRole` picks the text (the paused banner explains the rest); `isOwner` is the edit right.
  const isOwnerRole = me.role === "owner";
  const isOwner = isOwnerRole && canWrite(me);

  const keepShadow = async () => {
    setPending(true);
    try {
      await api("/api/onboarding/keep-mode", z.undefined(), { method: "POST" });
      reload();
    } catch (error) {
      toast.error(t(errorText(error)));
    } finally {
      setPending(false);
    }
  };

  let mailboxText = t("ob_mailbox_open");
  if (onboarding.mailbox) {
    mailboxText =
      me.mailboxCount === 1 ? t("ob_mailbox_done_one") : t("ob_mailbox_done_many", { count: me.mailboxCount });
  } else if (!isOwnerRole) {
    mailboxText = t("ob_mailbox_assistant");
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {onboarding.done && (
        <Alert>
          <AlertDescription>
            <p>{t("ob_all_set")}</p>
            <a href="/activity" className={buttonVariants({ variant: "outline" })}>
              {t("ob_go_activity")}
            </a>
          </AlertDescription>
        </Alert>
      )}
      <ol className="flex flex-col gap-3">
        <ChecklistItem title="ob_mailbox_title" done={onboarding.mailbox}>
          <p className="text-sm">{mailboxText}</p>
          {onboarding.mailbox && (
            <a href="/mailboxes" className={`${buttonVariants({ variant: "outline" })} self-start`}>
              {t("ob_manage")}
            </a>
          )}
          {!onboarding.mailbox && isOwner && (
            <a href="/mailboxes?connect=1" className={`${buttonVariants()} self-start`}>
              {t("mb_connect")}
            </a>
          )}
        </ChecklistItem>
        <ChecklistItem title="ob_telegram_title" done={onboarding.telegramAvailable ? onboarding.telegram : null}>
          <TelegramLink timeZone={me.organization.timezone} onChange={reload} />
        </ChecklistItem>
        <ChecklistItem title="ob_mode_title" done={onboarding.mode}>
          <p className="text-sm">
            {onboarding.mode ? t("ob_mode_done") : isOwnerRole ? t("ob_mode_open") : t("ob_mode_assistant")}
          </p>
          {!onboarding.mode && isOwner && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending} onClick={keepShadow}>
                {t("ob_keep_shadow")}
              </Button>
              <a href="/settings" className={buttonVariants({ variant: "outline" })}>
                {t("ob_open_settings")}
              </a>
            </div>
          )}
        </ChecklistItem>
        <ChecklistItem title="ob_rules_title" done={onboarding.rules > 0} optional>
          <p className="text-sm">{t("ob_rules_text")}</p>
          {onboarding.rules > 0 && (
            <p className="text-sm text-muted-foreground">
              {onboarding.rules === 1 ? t("ob_rules_one") : t("ob_rules_many", { count: onboarding.rules })}
            </p>
          )}
          <a href="/rules" className={`${buttonVariants({ variant: "outline" })} self-start`}>
            {t("ob_open_rules")}
          </a>
        </ChecklistItem>
      </ol>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <AppShell active="onboarding" title="title_onboarding">
      <Onboarding />
    </AppShell>
  );
}
