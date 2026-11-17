import { Delegations } from "../components/delegation/Delegations";
import { OpenLoops } from "../components/loops/OpenLoops";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { useLocale } from "../i18n";

// The page `/delegations`: the F102 delegations dashboard, or, while the flag `open_loops` is on, the "Open loops" page (F116 stage 21).
function Page() {
  const { me } = useMe();
  return me?.features.includes("open_loops") === true ? <OpenLoops /> : <Delegations />;
}

export default function DelegationsPage() {
  useLocale();
  return (
    <AppShell active="delegations" title="title_delegations">
      <Page />
    </AppShell>
  );
}
