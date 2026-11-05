const NAMED_ADDRESS = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/;

// One split rule for the eval runner and the seed script. The address keeps its case.
export function splitAddress(value: string): { name: string | null; address: string } {
  const match = NAMED_ADDRESS.exec(value);
  if (!match) return { name: null, address: value.trim() };

  const name = (match[1] ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  return { name: name === "" ? null : name, address: match[2] ?? "" };
}
