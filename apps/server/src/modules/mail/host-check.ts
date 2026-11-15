import { isIP } from "node:net";

import { isLocalAddress } from "../../platform/net-address";

export { isLocalAddress };

/**
 * True for a host that names this machine or a private network (B12). A name other than `localhost` is
 * public here: `resolveMailHost` (`host-guard.ts`) checks the addresses a name resolves to.
 */
export function isLocalMailHost(host: string): boolean {
  let value = host.trim().toLowerCase().replace(/\.+$/, ""); // the root dot: `localhost.` still resolves to loopback
  if (value === "localhost" || value.endsWith(".localhost")) return true;
  value = value.replace(/^\[/, "").replace(/\]$/, "");

  if (isIP(value) === 0) {
    // A resolver maps these spellings to addresses: `127.1`, `0`, `2130706433`, `0x7f.1`.
    return /^[0-9.]+$/.test(value) || value.split(".").some((label) => label.startsWith("0x"));
  }
  return isLocalAddress(value);
}
