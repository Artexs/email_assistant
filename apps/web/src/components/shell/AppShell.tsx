import { resolveLocale } from "@ea/core/web";
import { useEffect, type ReactNode } from "react";
import { RELEASES } from "virtual:ea-changelog-releases";

import { authClient } from "../../lib/auth-client";
import { ApiError } from "../../lib/api";
import { useRebindPush } from "../../lib/use-rebind-push";
import { setLocale, t, useLocale, type TextKey } from "../../i18n";
import { PageHead } from "../patterns/PageHead";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Toaster } from "../ui/sonner";
import { AuthErrorBanner } from "./AuthErrorBanner";
import { useMe, MeProvider } from "./MeProvider";
import { BottomTabs, MenuSheet, Sidebar } from "./Nav";
import { pageTitle, type NavKey } from "./nav-items";
import { PausedBanner } from "./PausedBanner";
import { TermsDialog } from "./TermsDialog";
import { TrialLine } from "./TrialLine";
import { browserStorage, WhatsNewSlot } from "./WhatsNew";

export interface AppShellProps {
  active: NavKey;
  title: TextKey;
  lead?: TextKey;
  leadVars?: Record<string, string | number>; // the values of `{name}` slots in the lead text
  action?: ReactNode;
  children: ReactNode;
}

async function logOut() {
  try {
    await authClient.signOut();
  } catch {
    // The cookie is gone or the session is dead: the login page is right either way.
  }
  location.assign("/login");
}

function onLogOut() {
  void logOut();
}

function Frame({ active, title, lead, leadVars, action, children }: AppShellProps) {
  const { me, error, loading, reload } = useMe();

  // After a sign-in on any device the panel follows the stored choice, else the browser. The same locale changes nothing.
  const userLocale = me?.user.locale;
  useEffect(() => {
    if (userLocale === undefined) return;
    setLocale(resolveLocale(userLocale, navigator.language));
  }, [userLocale]);

  // The Delegations page is "Open loops" while that flag is on; the shell knows the flags only after `me` came.
  const locale = useLocale();
  const features = me?.features ?? [];
  // Phone notices: an existing subscription of this browser follows the new session (once per page load).
  useRebindPush(features.includes("web_push"));
  const heading = pageTitle(active, title, features);
  useEffect(() => {
    document.title = `${t(heading)} · ${t("brand")}`;
  }, [heading, locale]);

  if (error instanceof ApiError && error.code === "no_organization") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">{t("no_organization_title")}</h1>
        <p>{t("no_organization_text")}</p>
        <Button onClick={onLogOut}>{t("log_out")}</Button>
      </main>
    );
  }

  const email = me?.user.email ?? null;
  const onboardingOpen = me === null || !me.onboarding.done;
  const operator = me?.operator === true;
  const approvalsWaiting = me?.approvalsWaiting ?? 0;
  const navProps = { active, onboardingOpen, operator, features, approvalsWaiting, email, loading, onLogOut };

  let content: ReactNode;
  if (me !== null) {
    content = children;
  } else if (loading) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-5/6" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col items-start gap-3">
        <p>{t("load_error_text")}</p>
        <Button onClick={reload}>{t("retry")}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <Sidebar {...navProps} />
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background px-4 py-3 lg:hidden">
          <p className="text-lg font-semibold">{t("brand")}</p>
          <MenuSheet {...navProps} />
        </header>
        <AuthErrorBanner count={me?.mailboxesInAuthError ?? 0} />
        {me?.organization.plan === "suspended" && <PausedBanner contact={me.operatorContact} />}
        {me?.organization.plan === "trial" && me.role === "owner" && me.organization.trialEndsAt !== null && (
          <TrialLine endsAt={me.organization.trialEndsAt} timeZone={me.organization.timezone} />
        )}
        {me !== null && !me.terms.accepted && (
          <TermsDialog current={me.terms.current} onAccepted={reload} onLogOut={onLogOut} />
        )}
        {me !== null && (
          <WhatsNewSlot features={features} releases={RELEASES} userId={me.user.id} getStorage={browserStorage} />
        )}
        <main className="px-4 py-4 pb-24 lg:pb-8">
          <PageHead title={t(heading)} lead={lead === undefined ? undefined : t(lead, leadVars)} action={action} />
          {content}
        </main>
      </div>
      <BottomTabs active={active} features={features} approvalsWaiting={approvalsWaiting} />
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  const locale = useLocale();
  const { title } = props;
  // The static title is English; the client sets the title in the current language.
  useEffect(() => {
    document.title = `${t(title)} · ${t("brand")}`;
  }, [title, locale]);
  return (
    <MeProvider>
      <Frame {...props} />
      <Toaster position="top-center" />
    </MeProvider>
  );
}
