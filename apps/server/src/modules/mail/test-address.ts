/** The test mailboxes of `TEST_MAILBOX_ADDRESS`: one address, or a comma-separated list. Trimmed, lower-cased, unique. */
export function parseTestAddresses(raw: string | undefined): string[] {
  const items = (raw ?? "").split(",").map((item) => item.trim().toLowerCase());
  return [...new Set(items.filter((item) => item !== ""))];
}

/** True when `address` is one of the test mailboxes (case-insensitive). An unset or empty list admits nothing. */
export function isTestAddress(address: string, raw: string | undefined): boolean {
  return parseTestAddresses(raw).includes(address.trim().toLowerCase());
}
