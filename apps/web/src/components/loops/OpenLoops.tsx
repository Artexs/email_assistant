import { LOOP_FILTER_OF_DELEGATION } from "../../lib/loops-view";
import { useLoopView } from "../../lib/use-loop-view";
import { Delegations } from "../delegation/Delegations";
import { DelegationTabs } from "../delegation/DelegationTabs";
import { useMe } from "../shell/MeProvider";
import { LoopFilterTabs, LoopTabs } from "./LoopTabs";
import { LoopsBoard } from "./LoopsBoard";

// The F102 page `/delegations` while the flag `open_loops` is on: the tabs Delegated, Waiting and Promised.
// The Delegated tab is the F102 list, then the loops that the analysis of the Sent mail tracked as a hand forward to a delegate. The
// F102 list needs the flag `delegation_pages`; without it (and without the Delegates header) the Delegated tab holds the loops only.
export function OpenLoops() {
  const { me } = useMe();
  const { tab, filter, selectTab, selectFilter } = useLoopView();
  const delegationsOn = me?.features.includes("delegation_pages") === true;
  const filterNav = <LoopFilterTabs tab={tab} current={filter} onSelect={selectFilter} />;

  let content;
  if (tab !== "delegated") {
    content = <LoopsBoard key={tab} kind={tab} filter={filter} filterNav={filterNav} />;
  } else if (delegationsOn) {
    content = (
      <Delegations
        embedded
        below={(delegationFilter) => {
          const loopFilter = LOOP_FILTER_OF_DELEGATION[delegationFilter];
          return loopFilter === null ? null : <LoopsBoard key={tab} kind="delegated" filter={loopFilter} showHeading />;
        }}
      />
    );
  } else {
    content = <LoopsBoard key={tab} kind="delegated" filter={filter} filterNav={filterNav} />;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {delegationsOn && <DelegationTabs current="delegations" />}
      <LoopTabs current={tab} onSelect={selectTab} />
      {content}
    </div>
  );
}
