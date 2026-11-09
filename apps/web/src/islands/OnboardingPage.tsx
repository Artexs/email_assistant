import { AppShell } from "../components/shell/AppShell";
import { Placeholder } from "../components/shell/Placeholder";

export default function OnboardingPage() {
  return (
    <AppShell active="onboarding" title="title_onboarding">
      <Placeholder />
    </AppShell>
  );
}
