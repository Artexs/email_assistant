import { useLoopView } from "../../lib/use-loop-view";
import { Delegations } from "../delegation/Delegations";
import { useMe } from "../shell/MeProvider";
import { LoopFilterTabs, LoopTabs } from "./LoopTabs";
import { LoopsBoard } from "./LoopsBoard";

// The page `/delegations` while the flag `open_loops` is on: the tabs Delegated, Waiting and Promised.
// The Delegated tab is the status columns of the delegations, then the loops that the analysis of the Sent mail tracked as a hand forward
// to a delegate, with their own filter links. The columns need the flag `delegation_pages`; without it (and without the Delegates header)
// the Delegated tab holds the loops only. On this tab `?filter=` is the loop filter; `closed` also opens the closed delegations at load.
export function OpenLoops() {
  const { me } = useMe();
  const { tab, filter, selectTab, selectFilter } = useLoopView();
  const delegationsOn = me?.features.includes("delegation_pages") === true;
  const filterNav = (
    <div className="flex">
      <LoopFilterTabs tab={tab} current={filter} onSelect={selectFilter} />
    </div>
  );

  // The loops keep a reading width (48 rem); the delegation columns use the whole page.
  const board = (
    <div className="max-w-3xl">
      <LoopsBoard
        key={tab}
        kind={tab}
        filter={filter}
        filterNav={filterNav}
        showHeading={tab === "delegated" && delegationsOn}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex">
        <LoopTabs current={tab} onSelect={selectTab} />
      </div>
      {tab === "delegated" && delegationsOn && <Delegations />}
      {board}
    </div>
  );
}
