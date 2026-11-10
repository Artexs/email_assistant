import { AppShell } from "../components/shell/AppShell";
import { Placeholder } from "../components/shell/Placeholder";

export default function SettingsPage() {
  return (
    <AppShell active="settings" title="title_settings">
      <Placeholder />
    </AppShell>
  );
}
