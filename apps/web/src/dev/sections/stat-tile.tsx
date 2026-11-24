import { StatTile } from "../../components/patterns/StatTile";
import type { PatternSection } from "../sections";

export const section: PatternSection = {
  title: "StatTile",
  order: 70,
  render: () => (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatTile value="0" label="serious mistakes" />
      <StatTile value="4 min" label="to tell you about urgent mail" />
      <StatTile value="1,284" label="mails handled for you" />
    </div>
  ),
};
