import { cn } from "cn";

// The five fill classes, written out in full so the build keeps them.
const FILLS = ["bg-avatar-1", "bg-avatar-2", "bg-avatar-3", "bg-avatar-4", "bg-avatar-5"] as const;

const SIZES = { sm: "size-8 rounded-sm text-xs", default: "size-10 rounded-[14px] text-sm" } as const;

// FNV-1a over the UTF-16 units of the name: the same name always gets the same fill.
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function avatarFill(name: string): string {
  return FILLS[hashName(name.trim().toLowerCase()) % FILLS.length] ?? FILLS[0];
}

// One or two letters: the first letter of each of the first two words, in capitals.
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

// A person or a mailbox. The letters are decoration: the name next to the avatar names it.
export function InitialsAvatar({ name, size = "default" }: { name: string; size?: "sm" | "default" }) {
  return (
    <span
      data-slot="initials-avatar"
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center font-extrabold text-avatar-foreground",
        avatarFill(name),
        SIZES[size]
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
