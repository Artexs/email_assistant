import { AppShell } from "../components/shell/AppShell";
import { Placeholder } from "../components/shell/Placeholder";

export default function MailboxesPage() {
  return (
    <AppShell active="mailboxes" title="title_mailboxes">
      <Placeholder />
    </AppShell>
  );
}
