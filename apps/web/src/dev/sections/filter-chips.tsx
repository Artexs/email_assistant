import { useState } from "react";

import { FilterChips } from "../../components/patterns/FilterChips";
import type { PatternSection } from "../sections";

const OPTIONS = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "replies", label: "Needs reply" },
  { value: "delegated", label: "Delegated" },
  { value: "spam", label: "Spam" },
  { value: "info", label: "Info" },
];

function Demo() {
  const [one, setOne] = useState<string[]>(["all"]);
  const [many, setMany] = useState<string[]>(["urgent", "spam"]);
  return (
    <div className="flex flex-col gap-4">
      <FilterChips label="One at a time" options={OPTIONS} value={one} onChange={setOne} single />
      <FilterChips label="Any number" options={OPTIONS} value={many} onChange={setMany} />
    </div>
  );
}

export const section: PatternSection = { title: "FilterChips", order: 60, render: () => <Demo /> };
