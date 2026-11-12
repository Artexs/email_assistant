// One-off (Limen transition, stage 1 step 1.9): moves the old task history from `tasks/` to Limen's
// feature lanes `spec/features/<lane>/FNNN-<name>/` and rewrites the links to the moved files.
// Plan: spec/features/active/F0NN-limen-transition/stages/stage-1-out-of-box.md § 1.9. Delete in stage 3.
//
//   bun scripts/one-off/migrate-tasks.ts migrate   # git mv, ticket.md, migration-map.tsv, link rewrite
//   bun scripts/one-off/migrate-tasks.ts links     # prints every relative link that does not resolve
//
// The S6 family (`s6-pre-sale`, `s6a`–`s6f`) and `tasks/README.md` stay in `tasks/` and are not edited.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, posix } from "node:path";

type Lane = "done" | "active" | "planned";

interface Task {
  name: string;
  state: Lane;
  oldFile: string;
  oldDir: string | null;
  opened: string;
  openedTs: number;
  landed: string | null;
  code: string;
  newDir: string;
}

const migrationDate = "2026-11-12";
const s6Family = /^s6(-|[a-f]-)/;
const textExtensions = new Set([
  "md",
  "ts",
  "tsx",
  "txt",
  "json",
  "sql",
  "astro",
  "mdc",
  "mermaid",
  "sh",
  "yml",
  "yaml",
  "html",
  "tsv",
]);

function git(args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString();
}

function trackedFiles(): string[] {
  return git(["ls-files", "-z"])
    .split("\0")
    .filter((path) => path.length > 0);
}

function isS6File(path: string): boolean {
  const match = /^tasks\/(?:done|active|planned)\/([^/]+?)(?:\.md)?(?:\/|$)/.exec(path);
  return match !== null && s6Family.test(match[1] ?? "");
}

// Oldest and newest add of a path set, with renames counted as delete + add.
function adds(paths: string[]): { ts: number; date: string }[] {
  return git(["log", "--no-renames", "--diff-filter=A", "--format=%ct %cs", "--", ...paths])
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [ts, date] = line.split(" ");
      return { ts: Number(ts), date: date ?? "" };
    });
}

function collectTasks(files: string[]): Task[] {
  const found: Omit<Task, "code" | "newDir">[] = [];
  for (const path of files) {
    const match = /^tasks\/(done|active|planned)\/([^/]+)\.md$/.exec(path);
    if (match === null) continue;
    const state = match[1] as Lane;
    const name = match[2] ?? "";
    if (s6Family.test(name)) continue;
    const oldDir = files.some((file) => file.startsWith(`tasks/${state}/${name}/`)) ? `tasks/${state}/${name}` : null;
    const all = adds(["done", "active", "planned"].map((lane) => `tasks/${lane}/${name}.md`));
    const first = all.at(-1);
    if (first === undefined) throw new Error(`no add commit for ${path}`);
    const landed = state === "done" ? (adds([path])[0]?.date ?? null) : null;
    found.push({ name, state, oldFile: path, oldDir, opened: first.date, openedTs: first.ts, landed });
  }
  found.sort((a, b) => a.openedTs - b.openedTs || a.name.localeCompare(b.name));
  return found.map((task, index) => {
    const code = `F${String(index + 1).padStart(3, "0")}`;
    const lanePath = task.state === "done" ? `done/${(task.landed ?? "").slice(0, 7)}` : task.state;
    return { ...task, code, newDir: `spec/features/${lanePath}/${code}-${task.name}` };
  });
}

// Old path → new path for every moved file, and old folder → new folder.
function buildMaps(tasks: Task[], files: string[]): { fileMap: Map<string, string>; dirMap: Map<string, string> } {
  const fileMap = new Map<string, string>();
  const dirMap = new Map<string, string>();
  for (const task of tasks) {
    fileMap.set(task.oldFile, `${task.newDir}/plan.md`);
    if (task.oldDir === null) continue;
    dirMap.set(task.oldDir, `${task.newDir}/stages`);
    for (const file of files) {
      if (file.startsWith(`${task.oldDir}/`)) {
        fileMap.set(file, `${task.newDir}/stages/${file.slice(task.oldDir.length + 1)}`);
      }
    }
  }
  return { fileMap, dirMap };
}

function knownPaths(files: string[]): Set<string> {
  const known = new Set<string>();
  for (const file of files) {
    known.add(file);
    let dir = posix.dirname(file);
    while (dir !== "." && !known.has(dir)) {
      known.add(dir);
      dir = posix.dirname(dir);
    }
  }
  return known;
}

function mapPath(path: string, fileMap: Map<string, string>, dirMap: Map<string, string>): string {
  const direct = fileMap.get(path) ?? dirMap.get(path);
  if (direct !== undefined) return direct;
  for (const [oldDir, newDir] of dirMap) {
    if (path.startsWith(`${oldDir}/`)) return `${newDir}/${path.slice(oldDir.length + 1)}`;
  }
  return path;
}

interface Rewriter {
  fileMap: Map<string, string>;
  dirMap: Map<string, string>;
  known: Set<string>;
  movedNames: Map<string, Task>;
}

const suffixPattern = /^([^#?]*?)((?::\d+(?:[-–]\d+)?)?(?:[#?].*)?)$/;

// A relative target as the file at `oldPath` wrote it → the same target written from `newPath`.
// Null when the target is not a tracked path of the old tree, or nothing changes.
function rewriteTarget(
  target: string,
  oldPath: string,
  newPath: string,
  rw: Rewriter,
  rootForm: boolean
): string | null {
  if (/^(?:[a-z]+:|#|\/|~|\$|<)/i.test(target)) return null;
  const parts = suffixPattern.exec(target);
  const bare = parts?.[1] ?? "";
  const suffix = parts?.[2] ?? "";
  if (bare.length === 0 || /\s/.test(bare)) return null;
  const trailing = bare.endsWith("/") ? "/" : "";
  const resolved = posix.normalize(posix.join(posix.dirname(oldPath), bare)).replace(/\/$/, "");
  if (rw.known.has(resolved)) {
    const mapped = mapPath(resolved, rw.fileMap, rw.dirMap);
    let next = posix.relative(posix.dirname(newPath), mapped);
    if (next.length === 0) next = ".";
    const result = `${next}${trailing}${suffix}`;
    return result === target ? null : result;
  }
  // A stale lane (the task moved from planned/ to done/ earlier): map it by task name.
  const stale = /^tasks\/(?:done|active|planned)\/([\w.-]+?)(\.md|\/.*)?$/.exec(resolved);
  const staleTask = stale === null ? undefined : rw.movedNames.get(stale[1] ?? "");
  if (staleTask !== undefined && (stale?.[2] === ".md" || stale?.[2]?.startsWith("/"))) {
    const rest = stale?.[2] ?? "";
    const mapped = rest === ".md" ? `${staleTask.newDir}/plan.md` : `${staleTask.newDir}/stages${rest}`;
    return `${posix.relative(posix.dirname(newPath), mapped)}${trailing}${suffix}`;
  }
  if (!rootForm) return null;
  const rooted = posix.normalize(bare).replace(/\/$/, "");
  if (rw.known.has(rooted) && mapPath(rooted, rw.fileMap, rw.dirMap) !== rooted) {
    return `${mapPath(rooted, rw.fileMap, rw.dirMap)}${trailing}${suffix}`;
  }
  return null;
}

function rewriteText(text: string, oldPath: string, newPath: string, rw: Rewriter): string {
  let out = text.replace(/\]\(([^)\s]+)\)/g, (whole, target: string) => {
    const next = rewriteTarget(target, oldPath, newPath, rw, false);
    return next === null ? whole : `](${next})`;
  });
  out = out.replace(/href="([^"]+)"/g, (whole, target: string) => {
    const next = rewriteTarget(target, oldPath, newPath, rw, false);
    return next === null ? whole : `href="${next}"`;
  });
  out = out.replace(/`([^`\n]+)`/g, (whole, token: string) => {
    if (!/^[\w.@/-]+(?::\d+(?:[-–]\d+)?)?(?:#[\w-]+)?$/.test(token) || !token.includes("/")) return whole;
    const next = rewriteTarget(token, oldPath, newPath, rw, true);
    return next === null ? whole : `\`${next}\``;
  });
  // Any other mention of an old task path (prose, code comments, absolute paths), by task name.
  out = out.replace(
    /tasks\/(?:done|active|planned)\/([\w.-]+?)(\.md|\/[\w./-]*)?(?![\w-])/g,
    (whole, name: string, rest?: string) => {
      const task = rw.movedNames.get(name);
      if (task === undefined) return whole;
      if (rest === undefined) return task.newDir;
      if (rest === ".md") return `${task.newDir}/plan.md`;
      return `${task.newDir}/stages${rest}`;
    }
  );
  return out;
}

function firstParagraph(section: string): string {
  const blocks = section
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith("<!--"));
  const block = blocks[0] ?? "";
  return block
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
        .replace(/^>\s?/, "")
        .trim()
    )
    .join(" ")
    .trim();
}

function ticketText(task: Task, plan: string): string {
  const heading = /^#\s+(.+)$/m.exec(plan)?.[1]?.trim() ?? task.name.replaceAll("-", " ");
  const title = heading.replace(/^(?:Task|Plan)\s*[:—-]\s*/i, "").replace(/^F\d+\s*·\s*/, "");
  const goal = /^##\s+(?:\d+\.\s*)?Goal\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(plan)?.[1];
  const status = /^>\s*\*\*Status[^\n]*/m.exec(plan)?.[0];
  let outcome = goal === undefined ? "" : firstParagraph(goal);
  if (outcome.length === 0 && status !== undefined) {
    outcome = status.replace(/^>\s*/, "").replaceAll("**", "").trim();
  }
  if (outcome.length === 0) outcome = `Old task \`${task.name}\`; see plan.md.`;
  const front = [`opened: ${task.opened}`, ...(task.landed === null ? [] : [`landed: ${task.landed}`])];
  return [
    "---",
    ...front,
    "---",
    "",
    `# ${task.code} · ${title}`,
    "",
    "## Outcome",
    "",
    outcome,
    "",
    "## Notes",
    "",
    `Moved from \`${task.oldFile}\` on ${migrationDate}. The full old task (plan, decisions, log): [plan.md](plan.md).${
      task.oldDir === null ? "" : ` Its stage files: [stages/](stages/).`
    }`,
    "",
  ].join("\n");
}

function isText(path: string): boolean {
  const extension = path.includes(".") ? (path.split(".").pop() ?? "") : "";
  return textExtensions.has(extension);
}

function migrate(): void {
  const files = trackedFiles();
  const tasks = collectTasks(files);
  const { fileMap, dirMap } = buildMaps(tasks, files);
  const rw: Rewriter = {
    fileMap,
    dirMap,
    known: knownPaths(files),
    movedNames: new Map(tasks.map((t) => [t.name, t])),
  };

  // 1. Rewrite links in the old tree (paths as they are now), keyed by the new path of each file.
  const rewritten = new Map<string, string>();
  for (const oldPath of files) {
    if (!isText(oldPath) || isS6File(oldPath) || !existsSync(oldPath)) continue;
    const newPath = mapPath(oldPath, fileMap, dirMap);
    const text = readFileSync(oldPath, "utf8");
    const next = rewriteText(text, oldPath, newPath, rw);
    if (next !== text || newPath !== oldPath) rewritten.set(oldPath, next);
  }

  // 2. Move with git, so `git log --follow` keeps the history.
  for (const task of tasks) {
    mkdirSync(task.newDir, { recursive: true });
    git(["mv", task.oldFile, `${task.newDir}/plan.md`]);
    if (task.oldDir !== null) git(["mv", task.oldDir, `${task.newDir}/stages`]);
  }
  for (const [oldPath, text] of rewritten) writeFileSync(mapPath(oldPath, fileMap, dirMap), text);

  // 3. Tickets and the map.
  for (const task of tasks) {
    const plan = readFileSync(`${task.newDir}/plan.md`, "utf8");
    writeFileSync(`${task.newDir}/ticket.md`, ticketText(task, plan));
  }
  const rows = [...fileMap.entries(), ...dirMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  writeFileSync(
    "spec/features/migration-map.tsv",
    `${["old\tnew", ...rows.map(([a, b]) => `${a}\t${b}`)].join("\n")}\n`
  );
  git(["add", "-A", "--", "spec/features"]);
  git(["add", "-u"]);
  process.stdout.write(
    `moved ${tasks.length} tasks (${dirMap.size} with stage folders), rewrote ${rewritten.size} files\n`
  );
  for (const task of tasks) process.stdout.write(`${task.code}\t${task.oldFile}\t${task.newDir}\n`);
}

// Every relative link target in tracked Markdown files that does not exist on disk.
function checkLinks(): void {
  let broken = 0;
  for (const path of trackedFiles()) {
    if (!path.endsWith(".md") || !existsSync(path)) continue;
    const text = readFileSync(path, "utf8").replace(/```[\s\S]*?```/g, "");
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1] ?? "";
      if (/^(?:[a-z]+:|#|~|\$|<)/i.test(target)) continue;
      const bare = (suffixPattern.exec(target)?.[1] ?? "").replace(/\/$/, "");
      if (bare.length === 0) continue;
      const resolved = target.startsWith("/") ? bare : normalize(join(dirname(path), bare));
      if (!existsSync(resolved)) {
        broken += 1;
        process.stdout.write(`${path}\t${target}\n`);
      }
    }
  }
  process.stdout.write(`broken: ${broken}\n`);
}

const mode = process.argv[2];
if (mode === "migrate") migrate();
else if (mode === "links") checkLinks();
else {
  process.stderr.write("usage: bun scripts/one-off/migrate-tasks.ts migrate|links\n");
  process.exit(2);
}
