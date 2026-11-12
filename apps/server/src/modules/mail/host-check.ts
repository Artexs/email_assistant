import { BlockList, isIP } from "node:net";

// Two lists: a BlockList matches an IPv4 address against an IPv4-mapped IPv6 subnet, so one list would refuse 8.8.8.8.
const localV4 = new BlockList();
const localV6 = new BlockList();
for (const [net, prefix] of [
  ["127.0.0.0", 8],
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10], // carrier-grade NAT, Tailscale
  ["198.18.0.0", 15], // benchmark
  ["192.0.0.0", 24], // IETF protocol assignments
] as const) {
  localV4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96], // IPv4-compatible
  ["::ffff:0:0", 96], // IPv4-mapped, in any spelling
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  localV6.addSubnet(net, prefix, "ipv6");
}

/**
 * True for an IPv4 or IPv6 literal in a refused range (local, private, Tailscale, benchmark). An IPv4-mapped IPv6
 * address is checked as IPv4. A string that is not an IP address is refused too (true).
 */
export function isLocalAddress(ip: string): boolean {
  let value = ip.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped?.[1] !== undefined && isIP(mapped[1]) === 4) value = mapped[1];

  const family = isIP(value);
  if (family === 0) return true;
  return family === 4 ? localV4.check(value, "ipv4") : localV6.check(value, "ipv6");
}

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
