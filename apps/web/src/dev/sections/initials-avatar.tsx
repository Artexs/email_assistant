import { InitialsAvatar } from "../../components/patterns/InitialsAvatar";
import type { PatternSection } from "../sections";

const NAMES = ["Tomasz Nowak", "Piotr Zielinski", "Anna Kowalska", "Maria Wisniewska", "Jan Lewandowski", "anna"];

export const section: PatternSection = {
  title: "InitialsAvatar",
  order: 30,
  render: () => (
    <div className="flex flex-col gap-4">
      {(["default", "sm"] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-4">
          {NAMES.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <InitialsAvatar name={name} size={size} />
              <span className="text-sm">{name}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};
