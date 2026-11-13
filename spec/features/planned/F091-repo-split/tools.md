# F091 · Split tools (used by stages 01 and 02)

Part of [`plan.md`](plan.md). The planning job ran each script below on a clone of `master` at `37e7239` (2026-11-13): the split of both files typechecks, `bun run lint` and `bun run test:unit` pass (1877 tests), every declaration keeps its text, every export keeps its name, and `git log --follow` of each new file reaches the first commit of the old file. `test:int` did not run (no DB in the planning job).

A worker copies each block into `/tmp/f091-sNN/<name>` (never into the worktree: `bun run lint` lints every `.ts` file in it) and runs it from the worktree root. The TypeScript scripts load the worktree's `typescript` package through `createRequire(<cwd>/package.json)`, so they work from `/tmp`.

## `history-copies.sh`

Makes one commit per new file that renames the old file to that file (a full copy), then one merge commit that holds all copies and not the old file, and fast-forwards the branch to it (plan.md D3). It needs a clean tree. It runs no hooks (plumbing commands only). The next normal commit trims the copies.

```bash
#!/usr/bin/env bash
# Keeps `git log --follow` for each new file of a split. For each name it makes one commit that renames
# <old file> to <dir>/<name>.ts (a full copy), then one merge commit with all copies and without <old file>,
# and fast-forwards the current branch to it. The next normal commit trims each copy to its part.
# Usage (from the repo root, clean tree): bash history-copies.sh <old file> <dir> <name> [<name> ...]
set -euo pipefail
old=$1
dir=$2
shift 2
[[ $# -gt 0 ]] || { echo "history-copies: no names" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "history-copies: the tree is not clean" >&2; exit 1; }
base=$(git rev-parse HEAD)
blob=$(git rev-parse "$base:$old")
tmp=$(mktemp -d)
parents=()
GIT_INDEX_FILE=$tmp/merge git read-tree "$base"
GIT_INDEX_FILE=$tmp/merge git update-index --force-remove "$old"
for name in "$@"; do
  GIT_INDEX_FILE=$tmp/$name git read-tree "$base"
  GIT_INDEX_FILE=$tmp/$name git update-index --add --cacheinfo "100644,$blob,$dir/$name.ts"
  GIT_INDEX_FILE=$tmp/$name git update-index --force-remove "$old"
  tree=$(GIT_INDEX_FILE=$tmp/$name git write-tree)
  parents+=(-p "$(git commit-tree "$tree" -p "$base" -m "History copy: $old as $dir/$name.ts (split, trimmed in the next commit)")")
  GIT_INDEX_FILE=$tmp/merge git update-index --add --cacheinfo "100644,$blob,$dir/$name.ts"
done
tree=$(GIT_INDEX_FILE=$tmp/merge git write-tree)
merge=$(git commit-tree "$tree" -p "$base" "${parents[@]}" -m "Split $old into $dir/ (history merge; the next commit trims the copies)")
git merge --quiet --ff-only "$merge"
rm -rf "$tmp"
echo "history merge $merge with $# copies"
```

## `split-repo.ts`

Writes `<module dir>/repo/<file>.ts` for each key of the map and `<module dir>/repo/index.ts`. Each top-level statement moves whole, with the comments above it. It rebuilds the imports of each file (relative paths one level deeper; a name of another new file as `./<file>`; interfaces and type aliases as `type`). A name that another new file uses and that was not exported gets `export` (an internal export: `index.ts` does not re-export it). `index.ts` re-exports every name that the old file exported, grouped by file. It stops with an error on a name that is not in the map, a mapped name that the file does not declare, a name in two files, or a statement it cannot move (a side-effect import, an aliased or namespace import, an `export … from`).

```ts
// Splits one repository file into a folder by a map of file -> top-level names.
// Usage (from the repo root): bun split-repo.ts <copy of the old repo.ts> <module dir> <map.json>
// It writes <module dir>/repo/<file>.ts and <module dir>/repo/index.ts from the text of the copy.
// Each top-level statement moves whole, with its leading comments. Imports are rebuilt per file.
// A name that is used by another file and was not exported gets `export` (an internal export; index.ts skips it).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// The worktree's TypeScript, also when this script lives outside the worktree.
const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript") as typeof import("typescript");

const [oldFile, moduleDir, mapFile] = process.argv.slice(2);
if (oldFile === undefined || moduleDir === undefined || mapFile === undefined) {
  throw new Error("usage: split-repo.ts <copy of the old repo.ts> <module dir> <map.json>");
}
const map = JSON.parse(readFileSync(mapFile, "utf8")) as Record<string, string[]>;
// Relative import paths of the copy are relative to the module dir, where the old file was.
const oldDir = path.resolve(moduleDir);
const newDir = path.join(oldDir, "repo");
const text = readFileSync(oldFile, "utf8");
const sf = ts.createSourceFile(oldFile, text, ts.ScriptTarget.Latest, true);

interface Imported {
  spec: string;
  typeOnly: boolean;
}
const imported = new Map<string, Imported>();
interface Decl {
  names: string[];
  text: string;
  node: ts.Statement;
  exported: boolean;
  isType: boolean;
  file: string;
}
const decls: Decl[] = [];
const fileOf = new Map<string, string>();
for (const [file, names] of Object.entries(map)) {
  for (const name of names) {
    if (fileOf.has(name)) throw new Error(`${name} is mapped twice`);
    fileOf.set(name, file);
  }
}

for (const st of sf.statements) {
  if (ts.isImportDeclaration(st)) {
    const spec = (st.moduleSpecifier as ts.StringLiteral).text;
    const clause = st.importClause;
    if (clause === undefined) throw new Error(`side-effect import ${spec} is not supported`);
    if (clause.name !== undefined) imported.set(clause.name.text, { spec, typeOnly: clause.isTypeOnly });
    const bindings = clause.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.propertyName !== undefined) throw new Error(`aliased import ${element.name.text} is not supported`);
        imported.set(element.name.text, { spec, typeOnly: clause.isTypeOnly || element.isTypeOnly });
      }
    } else if (bindings !== undefined) throw new Error(`namespace import from ${spec} is not supported`);
    continue;
  }
  let names: string[] = [];
  if (ts.isVariableStatement(st)) names = st.declarationList.declarations.map((d) => (d.name as ts.Identifier).text);
  else if (
    ts.isFunctionDeclaration(st) ||
    ts.isInterfaceDeclaration(st) ||
    ts.isTypeAliasDeclaration(st) ||
    ts.isClassDeclaration(st) ||
    ts.isEnumDeclaration(st)
  )
    names = [st.name?.text ?? ""];
  else throw new Error(`unsupported top-level statement at line ${sf.getLineAndCharacterOfPosition(st.getStart()).line + 1}`);
  const files = new Set(names.map((name) => fileOf.get(name)));
  if (files.has(undefined)) throw new Error(`not in the map: ${names.join(", ")}`);
  if (files.size !== 1) throw new Error(`one statement, two files: ${names.join(", ")}`);
  // Leading comments belong to the statement; the first one also drops the blank lines after the imports.
  const raw = text.slice(st.getFullStart(), st.end).replace(/^\s*\n/, "");
  const exported = (ts.getCombinedModifierFlags(st as unknown as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
  const isType = ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st);
  decls.push({ names, text: raw, node: st, exported, isType, file: [...files][0] as string });
}
for (const name of fileOf.keys()) {
  if (!decls.some((decl) => decl.names.includes(name))) throw new Error(`mapped but not in the file: ${name}`);
}

const declOf = new Map<string, Decl>();
for (const decl of decls) for (const name of decl.names) declOf.set(name, decl);

function refsOf(node: ts.Node, own: string[]): Set<string> {
  const refs = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && !own.includes(n.text) && (imported.has(n.text) || declOf.has(n.text))) {
      // Skip property names (`a.name`, `{ name: x }` keys) that only look like a top-level name.
      const parent = n.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
        (ts.isPropertyAssignment(parent) && parent.name === n) ||
        (ts.isPropertySignature(parent) && parent.name === n) ||
        (ts.isMethodDeclaration(parent) && parent.name === n);
      if (!isPropertyName) refs.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return refs;
}

const relSpec = (spec: string): string => {
  if (!spec.startsWith(".")) return spec;
  const target = path.resolve(oldDir, spec);
  const rel = path.relative(newDir, target);
  return rel.startsWith(".") ? rel : `./${rel}`;
};

// Pass 1: which names other files use.
const usedElsewhere = new Set<string>();
const fileRefs = new Map<string, Set<string>>();
for (const file of Object.keys(map)) {
  const refs = new Set<string>();
  for (const decl of decls.filter((d) => d.file === file)) for (const ref of refsOf(decl.node, decl.names)) refs.add(ref);
  fileRefs.set(file, refs);
  for (const ref of refs) {
    const owner = declOf.get(ref);
    if (owner !== undefined && owner.file !== file) usedElsewhere.add(ref);
  }
}

mkdirSync(newDir, { recursive: true });
for (const file of Object.keys(map)) {
  const refs = fileRefs.get(file) as Set<string>;
  const bySpec = new Map<string, { names: Set<string>; types: Set<string> }>();
  const add = (spec: string, name: string, typeOnly: boolean): void => {
    const entry = bySpec.get(spec) ?? { names: new Set<string>(), types: new Set<string>() };
    (typeOnly ? entry.types : entry.names).add(name);
    bySpec.set(spec, entry);
  };
  for (const ref of refs) {
    const imp = imported.get(ref);
    if (imp !== undefined) add(relSpec(imp.spec), ref, imp.typeOnly);
    const owner = declOf.get(ref);
    if (owner !== undefined && owner.file !== file) add(`./${owner.file}`, ref, owner.isType);
  }
  const lines: string[] = [];
  for (const [spec, { names, types }] of [...bySpec.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = [...[...names].sort(), ...[...types].sort().map((t) => `type ${t}`)];
    if (names.size === 0) lines.push(`import type { ${[...types].sort().join(", ")} } from "${spec}";`);
    else lines.push(`import { ${parts.join(", ")} } from "${spec}";`);
  }
  const body = decls
    .filter((d) => d.file === file)
    .map((d) => {
      if (d.exported || !d.names.some((name) => usedElsewhere.has(name))) return d.text;
      // Insert `export ` before the declaration keyword, after its leading comments.
      const start = d.text.length - (d.node.end - d.node.getStart());
      return `${d.text.slice(0, start)}export ${d.text.slice(start)}`;
    });
  writeFileSync(path.join(newDir, `${file}.ts`), `${lines.join("\n")}\n\n${body.join("\n")}\n`);
}

// index.ts: every name the old file exported, from its new file. Internal exports stay out.
const indexLines: string[] = [];
for (const file of Object.keys(map)) {
  const exportedDecls = decls.filter((d) => d.file === file && d.exported);
  if (exportedDecls.length === 0) continue;
  const values = exportedDecls.filter((d) => !d.isType).flatMap((d) => d.names).sort();
  const types = exportedDecls.filter((d) => d.isType).flatMap((d) => d.names).sort();
  const parts = [...values, ...types.map((t) => `type ${t}`)];
  indexLines.push(`export { ${parts.join(", ")} } from "./${file}";`);
}
writeFileSync(path.join(newDir, "index.ts"), `${indexLines.join("\n")}\n`);
console.log(`wrote ${Object.keys(map).length + 1} files to ${newDir}`);
```

## `same-bodies.ts`

Proves "moves, not rewrites": each top-level declaration of the old file is in exactly one new file, with the same text (whitespace and a leading `export ` ignored), and no new file declares a new name. Prints `SAME_BODIES <count>` and exits 0, or one line per problem and exits 1. The planning job changed one constant in a copy: the script printed `RETENTION_BATCH: text changed in retention.ts` and exited 1.

```ts
// Checks that each top-level declaration of the old repo.ts is in exactly one file of <module dir>/repo/ with the same text.
// Whitespace and a leading `export ` are ignored. Usage (from the repo root): bun same-bodies.ts <copy of old repo.ts> <module dir>
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript") as typeof import("typescript");
const [oldFile, moduleDir] = process.argv.slice(2);
if (oldFile === undefined || moduleDir === undefined) throw new Error("usage: same-bodies.ts <old repo.ts> <module dir>");

function declarations(file: string): Map<string, string> {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) continue;
    const names = ts.isVariableStatement(st)
      ? st.declarationList.declarations.map((d) => (d.name as ts.Identifier).text)
      : [((st as ts.DeclarationStatement).name as ts.Identifier | undefined)?.text ?? "?"];
    const body = text.slice(st.getStart(), st.end).replace(/^export\s+/, "").replace(/\s+/g, "");
    for (const name of names) out.set(name, body);
  }
  return out;
}

const oldDecls = declarations(oldFile);
const newDecls = new Map<string, { file: string; body: string }[]>();
const repoDir = path.join(moduleDir, "repo");
for (const name of readdirSync(repoDir).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
  for (const [decl, body] of declarations(path.join(repoDir, name))) {
    newDecls.set(decl, [...(newDecls.get(decl) ?? []), { file: name, body }]);
  }
}
const problems: string[] = [];
for (const [name, body] of oldDecls) {
  const found = newDecls.get(name) ?? [];
  if (found.length !== 1) problems.push(`${name}: in ${found.length} files`);
  else if (found[0]?.body !== body) problems.push(`${name}: text changed in ${found[0]?.file}`);
}
for (const name of newDecls.keys()) if (!oldDecls.has(name)) problems.push(`${name}: new declaration`);
console.log(problems.length === 0 ? `SAME_BODIES ${oldDecls.size}` : problems.join("\n"));
process.exit(problems.length === 0 ? 0 : 1);
```

## `exports-of.ts`

Prints the sorted export names (values and types) of one module. The stage compares the old file with the new `repo/index.ts`.

```ts
// Prints the sorted export names (values and types) of one TypeScript module.
import { createRequire } from "node:module";
import { join } from "node:path";

const ts = createRequire(join(process.cwd(), "package.json"))("typescript") as typeof import("typescript");

const file = process.argv[2];
if (file === undefined) throw new Error("usage: exports-of.ts <file>");
const program = ts.createProgram([file], { noEmit: true, allowJs: false, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const checker = program.getTypeChecker();
const source = program.getSourceFile(file);
const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
if (symbol === undefined) throw new Error(`no module symbol for ${file}`);
for (const name of checker.getExportsOfModule(symbol).map((s) => s.name).sort()) console.log(name);
```

## `actions-map.json` (stage 01)

Names as of `master` after F086 stages 01 and 02 (plan.md D5): `ExpireFilter` is gone from `actions/repo.ts` (it moved to `@ea/core`), `PayloadKeepRule` is new. Order of keys = order of the files in `index.ts`.

```json
{
  "shared": [
    "DbOrTrx",
    "actionTypeSchema"
  ],
  "planned": [
    "isOwnActionId",
    "PlannedActionInput",
    "CreatedAction",
    "draftKeyOf",
    "createPlanned",
    "setDelegationId"
  ],
  "reads": [
    "ActionRow",
    "listActionsForEmail",
    "listSummaries",
    "moveTargetSchema",
    "sendKindSchema",
    "listActionsForEmails",
    "listDraftTasks",
    "countActionsSince"
  ],
  "filters": [
    "MailboxClaimFilter",
    "SendClaimFilter",
    "ClaimFilter",
    "sqlTrue",
    "sqlFalse",
    "mailboxFilterExpr",
    "sendFilterExpr"
  ],
  "claims": [
    "ClaimedAction",
    "CLAIM_MAX_AGE_MS",
    "CLAIM_MAX_MAIL_AGE_MS",
    "TYPE_RANK",
    "ClaimEb",
    "ClaimWindow",
    "draftApplied",
    "sendWaits",
    "claimableWhere",
    "countClaimable",
    "countHeldSends",
    "claimActions"
  ],
  "lifecycle": [
    "markApplying",
    "ProviderResult",
    "FinishNext",
    "finishAction",
    "releaseAction",
    "releaseActions",
    "updateProviderResult"
  ],
  "expiry": [
    "expireStaleReady",
    "countReadyOriginals",
    "expireReadyOriginals"
  ],
  "undo": [
    "markUndone",
    "UndoCandidate",
    "lockActionsForUndo",
    "insertReverse",
    "lockLatestOriginalMove"
  ],
  "sends": [
    "SendRow",
    "sendBase",
    "sendQuery",
    "SendQueryRow",
    "toSendRow",
    "lockSend",
    "getSend",
    "setExpired",
    "listOpenReminderSends",
    "setApproved",
    "setRejected",
    "listSetSends",
    "findSendByKey",
    "insertSendAgain"
  ],
  "drafts": [
    "DraftRow",
    "draftQuery",
    "toDraftRow",
    "lockDraft",
    "getDraft",
    "draftHasReverse",
    "listSendsOfDraft",
    "expireReadyDraft"
  ],
  "notify": [
    "FailedAction",
    "listFailedUnnotified",
    "markNotified",
    "notifiableSends",
    "listSendsToNotify",
    "listSetsToNotify",
    "listSendResultsToNotify",
    "markResultNotified"
  ],
  "approvals": [
    "ExpiredReason",
    "requestSent",
    "listExpiredApprovals",
    "listUnseenApprovalSends",
    "listAwaitingSendIds",
    "countApprovals"
  ],
  "retention": [
    "RETENTION_BATCH",
    "PAYLOAD_TYPES",
    "CLOSED_STATUSES",
    "PayloadKeepRule",
    "clearActionPayloads",
    "clearActionErrors"
  ]
}
```

## `mail-map.json` (stage 02)

```json
{
  "shared": [
    "DbOrTrx"
  ],
  "mailboxes": [
    "MailboxRow",
    "toMailboxRow",
    "insertMailbox",
    "getMailbox",
    "findMailboxIdByAddress",
    "countMailboxesOfOrg",
    "lockMailboxLimit",
    "lockMailbox",
    "markSynced",
    "MailboxStatus",
    "mailboxStatusSchema",
    "setMailboxStatus",
    "changeMailboxStatus",
    "MailboxSummary",
    "summaryColumns",
    "getMailboxSummary",
    "listMailboxes",
    "mailboxHasUidplus",
    "setFolderMapEntry"
  ],
  "folders": [
    "syncFolderKeySchema",
    "syncFolderRoleSchema",
    "SyncFolderRow",
    "toSyncFolderRow",
    "insertInboxFolder",
    "getSyncFolder",
    "lockSyncFolder",
    "listSyncFolders",
    "insertSyncFolders",
    "lockSyncFolderByKey",
    "updateSyncFolderEnabled",
    "getJunkFolderPath",
    "Cursor",
    "toInt8",
    "updateFolderCursor",
    "updateCursor",
    "forceRescan"
  ],
  "credentials": [
    "insertCredentials",
    "updateCredentials",
    "getCredentials"
  ],
  "copies": [
    "findCopies",
    "listFolderUids",
    "MovedRow",
    "listRecentlyMoved"
  ],
  "emails": [
    "MailKind",
    "mailKindFilter",
    "NewEmail",
    "insertEmail",
    "updateEmailUid",
    "markEmailReturned",
    "markEmailRelocated",
    "listReturned",
    "clearReturned",
    "setUndoPending",
    "getEmailMailbox",
    "EmailMeta",
    "getEmailMeta",
    "updateEmailLocation"
  ],
  "targets": [
    "listMailboxTargets",
    "listAuthErrorMailboxesBefore",
    "listSyncTargets",
    "countSyncTargets"
  ],
  "claims": [
    "ClaimedEmail",
    "claimEmails",
    "releaseEmail",
    "finishEmail",
    "countWaiting",
    "requeueTooOld"
  ],
  "lookup": [
    "listThreadContext",
    "listFolderEmailKeys",
    "MESSAGE_ID_CHUNK",
    "EmailByMessageIdRow",
    "listEmailsByMessageIds"
  ],
  "retention": [
    "RETENTION_BATCH",
    "PENDING_BODY_DAYS",
    "clearMailBodies",
    "clearMailHeaders"
  ]
}
```
