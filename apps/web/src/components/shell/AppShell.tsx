import type { ReactNode } from "react";

import { authClient } from "../../lib/auth-client";
import { ApiError } from "../../lib/api";
import { t, type TextKey } from "../../i18n/en";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Toaster } from "../ui/sonner";
import { AuthErrorBanner } from "./AuthErrorBanner";
import { useMe, MeProvider } from "./MeProvider";
import { BottomTabs, MenuSheet, Sidebar } from "./Nav";
import type { NavKey } from "./nav-items";
import { PausedBanner } from "./PausedBanner";
import { TermsDialog } from "./TermsDialog";
import { TrialLine } from "./TrialLine";

export interface AppShellProps {
  active: NavKey;
  title: TextKey;
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

function Frame({ active, title, children }: AppShellProps) {
  const { me, error, loading, reload } = useMe();

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
  const navProps = { active, onboardingOpen, email, loading, onLogOut };

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
          <h1 className="text-lg font-semibold">{t(title)}</h1>
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
        <main className="px-4 py-4 pb-24 lg:pb-8">
          <h1 className="mb-4 hidden text-xl font-semibold lg:block">{t(title)}</h1>
          {content}
        </main>
      </div>
      <BottomTabs active={active} />
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  return (
    <MeProvider>
      <Frame {...props} />
      <Toaster position="top-center" />
    </MeProvider>
  );
}
