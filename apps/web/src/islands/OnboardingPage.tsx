import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { ChecklistItem } from "../components/onboarding/ChecklistItem";
import { ModeCards } from "../components/onboarding/ModeCards";
import { ProgressCard } from "../components/onboarding/ProgressCard";
import { FactBox } from "../components/patterns/FactBox";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { TelegramLink } from "../components/telegram/TelegramLink";
import { buttonVariants } from "../components/ui/button";
import { t, tp, useLocale, type TextKey } from "../i18n";
import { canWrite } from "../lib/can-write";
import { onboardingProgress, type StepKey } from "../lib/onboarding-view";

interface Step {
  key: StepKey | "rules";
  title: TextKey;
  done: boolean | null;
  optional?: boolean;
  body: ReactNode;
}

function Onboarding() {
  const { me, reload } = useMe();

  if (me === null) return null;
  const { onboarding } = me;
  // `isOwnerRole` picks the text (the paused banner explains the rest); `isOwner` is the edit right.
  const isOwnerRole = me.role === "owner";
  const isOwner = isOwnerRole && canWrite(me);
  const progress = onboardingProgress(onboarding);

  let mailboxText = t("ob_mailbox_open");
  if (onboarding.mailbox) {
    mailboxText = tp("ob_mailbox_done", me.mailboxCount);
  } else if (!isOwnerRole) {
    mailboxText = t("ob_mailbox_assistant");
  }

  const mailboxStep: Step = {
    key: "mailbox",
    title: "ob_mailbox_title",
    done: onboarding.mailbox,
    body: (
      <>
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
      </>
    ),
  };

  const trustSteps: Step[] = [
    {
      key: "channel",
      title: "ob_channel_title",
      done: onboarding.telegramAvailable ? onboarding.channel : null,
      body: (
        <>
          <TelegramLink timeZone={me.organization.timezone} onChange={reload} />
          {onboarding.channel && !onboarding.telegram && <p className="text-sm">{t("ob_channel_mail")}</p>}
        </>
      ),
    },
    {
      key: "report",
      title: "ob_report_title",
      done: onboarding.report,
      body: (
        <>
          <p className="text-sm">
            {onboarding.report ? t("ob_report_done") : onboarding.mailbox ? t("ob_report_open") : t("ob_report_wait")}
          </p>
          {onboarding.mailbox && (
            <a href="/report" className={`${buttonVariants({ variant: "outline" })} self-start`}>
              {t("ob_report_link")}
            </a>
          )}
        </>
      ),
    },
  ];

  const modeSteps: Step[] = [
    {
      key: "telegram",
      title: "ob_telegram_title",
      done: onboarding.telegramAvailable ? onboarding.telegram : null,
      body: <TelegramLink timeZone={me.organization.timezone} onChange={reload} />,
    },
    {
      key: "mode",
      title: "ob_mode_title",
      done: onboarding.mode,
      body: (
        <>
          <p className="text-sm">
            {onboarding.mode ? t("ob_mode_done") : isOwnerRole ? t("ob_mode_open") : t("ob_mode_assistant")}
          </p>
          {!onboarding.mode && <ModeCards canAct={isOwner} onDone={reload} />}
          {!onboarding.mode && isOwner && (
            <a href="/settings" className={`${buttonVariants({ variant: "outline" })} self-start`}>
              {t("ob_open_settings")}
            </a>
          )}
        </>
      ),
    },
  ];

  const rulesStep: Step = {
    key: "rules",
    title: "ob_rules_title",
    done: onboarding.rules > 0,
    optional: true,
    body: (
      <>
        <p className="text-sm">{t("ob_rules_text")}</p>
        {onboarding.rules > 0 && <p className="text-sm text-muted-foreground">{tp("ob_rules", onboarding.rules)}</p>}
        <a href="/rules" className={`${buttonVariants({ variant: "outline" })} self-start`}>
          {t("ob_open_rules")}
        </a>
      </>
    ),
  };

  const steps = [mailboxStep, ...(onboarding.trust ? trustSteps : modeSteps), rulesStep];

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      {onboarding.done && (
        <FactBox icon={CircleCheck}>
          <div className="flex flex-col items-start gap-3">
            <p>{t("ob_all_set")}</p>
            <a href="/activity" className={buttonVariants({ variant: "outline" })}>
              {t("ob_go_activity")}
            </a>
          </div>
        </FactBox>
      )}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr] lg:items-start">
        <ProgressCard progress={progress} />
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <ChecklistItem
              key={step.key}
              number={index + 1}
              title={step.title}
              done={step.done}
              current={step.key === progress.current}
              optional={step.optional}
            >
              {step.body}
            </ChecklistItem>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  useLocale();
  return (
    <AppShell active="onboarding" title="title_onboarding" lead="ob_lead">
      <Onboarding />
    </AppShell>
  );
}
