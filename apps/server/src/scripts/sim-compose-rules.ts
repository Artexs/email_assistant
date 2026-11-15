// The rules of deploy/compose.sim.yaml that keep the sim stack apart from production. Pure: a parsed Compose file in, codes out.
// A code names the service and the rule; it never holds a value of the file.
type Doc = Record<string, unknown>;

const GUARDED = ["fake-telegram", "server", "lab"] as const;
const GUARD_PREFIX = "bun run lab:env-check &&";
const SIM_SERVICES = ["db", "fake-telegram", "greenmail", "lab", "server"];
const SIM_SUBNET = "172.31.0.0/24";
const PRODUCTION_IMAGE = "ea-server";

function asDoc(value: unknown): Doc {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Doc) : {};
}

function envFiles(value: unknown): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => (typeof item === "string" ? item : String(asDoc(item).path ?? "")));
}

// `command` is a string or a list. For `sh -c <script>` the script decides; any other list is joined.
function commandText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  const parts = value.map(String);
  const shell = parts.findIndex((part) => part === "-c");
  return (shell >= 0 ? parts.slice(shell + 1).join(" ") : parts.join(" ")).trim();
}

function portIsLoopback(port: unknown): boolean {
  if (typeof port === "object" && port !== null) return asDoc(port).host_ip === "127.0.0.1";
  const parts = String(port).split(":");
  return parts.length >= 3 && parts[0] === "127.0.0.1";
}

export function checkSimCompose(doc: unknown): string[] {
  const root = asDoc(doc);
  const services = asDoc(root.services);
  const issues: string[] = [];
  const add = (service: string, rule: string) => issues.push(`${service}: ${rule}`);

  if (root.name !== "ea-sim") add("project", "name_not_ea_sim");
  if (Object.keys(services).sort().join(" ") !== SIM_SERVICES.join(" ")) add("project", "service_set_changed");
  const subnets = asDoc(asDoc(asDoc(root.networks).default).ipam).config;
  const subnet = Array.isArray(subnets) ? asDoc(subnets[0]).subnet : undefined;
  if (subnet !== SIM_SUBNET) add("project", "subnet_not_sim");

  for (const [name, raw] of Object.entries(services)) {
    const service = asDoc(raw);
    if (service.mem_limit === undefined) add(name, "no_mem_limit");
    if (service.image === PRODUCTION_IMAGE) add(name, "production_image_tag");
    const args = asDoc(asDoc(service.build).args);
    if (String(args.EA_SERVER_IMAGE ?? "").replace(/^\$\{EA_SERVER_IMAGE:-|\}$/g, "") === PRODUCTION_IMAGE) {
      add(name, "production_base_tag");
    }
    const ports = Array.isArray(service.ports) ? service.ports : [];
    if (ports.some((port) => !portIsLoopback(port))) add(name, "port_not_loopback");
    if (service.network_mode !== undefined && service.network_mode !== "service:fake-telegram") {
      add(name, "network_mode_not_fake_telegram");
    }
    if (envFiles(service.env_file).some((path) => path !== "sim.env")) add(name, "env_file_not_sim_env");
  }

  for (const name of GUARDED) {
    const service = asDoc(services[name]);
    if (service.command === undefined || !commandText(service.command).startsWith(GUARD_PREFIX)) {
      add(name, "command_without_env_guard");
    }
    if (envFiles(service.env_file).join() !== "sim.env") add(name, "env_file_not_sim_env");
  }
  for (const name of ["server", "lab"] as const) {
    if (asDoc(services[name]).network_mode !== "service:fake-telegram") add(name, "network_mode_not_fake_telegram");
  }
  const owner = asDoc(services["fake-telegram"]);
  if (owner.network_mode !== undefined) add("fake-telegram", "network_mode_not_fake_telegram");
  return [...new Set(issues)];
}
