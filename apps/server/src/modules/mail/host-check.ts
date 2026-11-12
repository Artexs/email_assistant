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
 * True for a host that names this machine or a private network (B12). A name other than `localhost` is
 * public here: the DNS-level check is a follow-up (`spec/features/planned/F056-web-public-hardening/plan.md`).
 */
export function isLocalMailHost(host: string): boolean {
  let value = host.trim().toLowerCase().replace(/\.+$/, ""); // the root dot: `localhost.` still resolves to loopback
  if (value === "localhost" || value.endsWith(".localhost")) return true;
  value = value.replace(/^\[/, "").replace(/\]$/, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1] !== undefined && isIP(mapped[1]) === 4) value = mapped[1];

  const family = isIP(value);
  if (family === 0) {
    // A resolver maps these spellings to addresses: `127.1`, `0`, `2130706433`, `0x7f.1`.
    return /^[0-9.]+$/.test(value) || value.split(".").some((label) => label.startsWith("0x"));
  }
  return family === 4 ? localV4.check(value, "ipv4") : localV6.check(value, "ipv6");
}
