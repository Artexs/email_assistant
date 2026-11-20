// The rules of deploy/compose.sim.yaml that keep the sim stack apart from production. Pure: a parsed Compose file in, codes out.
// A code names the service and the rule; it never holds a value of the file.
type Doc = Record<string, unknown>;

const GUARDED = ["fake-telegram", "server", "lab"] as const;
const GUARD_PREFIX = "bun run lab:env-check &&";
const SIM_SERVICES = ["db", "fake-telegram", "greenmail", "lab", "server"];
const SIM_SUBNET = "172.31.0.0/24";
// The production image under any tag or registry prefix: `ea-server`, `ea-server:latest`, `docker.io/library/ea-server:1`.
const PRODUCTION_IMAGE = /^(docker\.io\/library\/)?ea-server(:|$)/;
// The only bind mounts of the sim stack (paths relative to deploy/). Any other source can reach a production file such as ../.env.
const ALLOWED_BIND_SOURCES = ["../db/roles.sql", "./db-init"];

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

// The names a service joins in `networks`: a list or a map. Only the default network of the project is allowed.
function networkNames(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : Object.keys(asDoc(value));
}

// The base tag of the build: the default of `${EA_SERVER_IMAGE:-<tag>}`, or a literal.
function baseTag(value: unknown): string {
  return String(value ?? "").replace(/^\$\{EA_SERVER_IMAGE:-|\}$/g, "");
}

// The source of a bind mount, or undefined for a named volume. A source is a bind when it is a path.
function bindSource(volume: unknown, named: Set<string>): string | undefined {
  if (typeof volume === "object" && volume !== null) {
    const long = asDoc(volume);
    return long.type === "bind" ? String(long.source ?? "") : undefined;
  }
  const source = String(volume).split(":")[0] ?? "";
  return named.has(source) ? undefined : source;
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

  for (const kind of ["networks", "volumes"] as const) {
    for (const entry of Object.values(asDoc(root[kind]))) {
      if (asDoc(entry).external !== undefined) add("project", `external_${kind === "networks" ? "network" : "volume"}`);
    }
  }
  const namedVolumes = new Set(Object.keys(asDoc(root.volumes)));

  for (const [name, raw] of Object.entries(services)) {
    const service = asDoc(raw);
    if (service.mem_limit === undefined) add(name, "no_mem_limit");
    if (PRODUCTION_IMAGE.test(String(service.image ?? ""))) add(name, "production_image_tag");
    if (PRODUCTION_IMAGE.test(baseTag(asDoc(asDoc(service.build).args).EA_SERVER_IMAGE))) {
      add(name, "production_base_tag");
    }
    // An entrypoint would run before the command, so it could skip the env guard.
    if (service.entrypoint !== undefined) add(name, "entrypoint_set");
    if (service.extends !== undefined) add(name, "extends_used");
    if (networkNames(service.networks).some((network) => network !== "default")) add(name, "network_not_default");
    if (service.ports !== undefined && !Array.isArray(service.ports)) add(name, "ports_not_list");
    const ports = Array.isArray(service.ports) ? service.ports : [];
    if (ports.some((port) => !portIsLoopback(port))) add(name, "port_not_loopback");
    const volumes = Array.isArray(service.volumes) ? service.volumes : [];
    for (const volume of volumes) {
      const source = bindSource(volume, namedVolumes);
      if (source !== undefined && !ALLOWED_BIND_SOURCES.includes(source)) add(name, "bind_mount_not_allowed");
    }
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
  // The server opens plain mail only to a loopback host, so GreenMail must share the namespace of the server (127.0.0.1).
  for (const name of ["server", "lab", "greenmail"] as const) {
    if (asDoc(services[name]).network_mode !== "service:fake-telegram") add(name, "network_mode_not_fake_telegram");
  }
  // GreenMail has no auth: no port of it may leave the stack.
  if (asDoc(services.greenmail).ports !== undefined) add("greenmail", "greenmail_port_published");
  const owner = asDoc(services["fake-telegram"]);
  if (owner.network_mode !== undefined) add("fake-telegram", "network_mode_not_fake_telegram");
  return [...new Set(issues)];
}
