import { DelegationSwitch } from "../components/delegation/DelegationTabs";
import { Delegations } from "../components/delegation/Delegations";
import { OpenLoops } from "../components/loops/OpenLoops";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { useLocale } from "../i18n";

// The page `/delegations`: the delegations dashboard, or, while the flag `open_loops` is on, the "Open loops" page.
function Page() {
  const { me } = useMe();
  return me?.features.includes("open_loops") === true ? <OpenLoops /> : <Delegations />;
}

export default function DelegationsPage() {
  useLocale();
  return (
    <AppShell
      active="delegations"
      title="title_delegations"
      lead="dgn_lead"
      action={<DelegationSwitch current="delegations" />}
    >
      <Page />
    </AppShell>
  );
}
