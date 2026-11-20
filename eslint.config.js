import { includeIgnoreFile } from "@eslint/compat";
import eslint from "@eslint/js";
import { builtinRules } from "eslint/use-at-your-own-risk";
import eslintPluginAstro from "eslint-plugin-astro";
import eslintPluginImport from "eslint-plugin-import";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import jsxA11y from "eslint-plugin-jsx-a11y";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

import ea from "./tools/eslint-rules/index.js";

// File path setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

// Module borders (docs/code-patterns.md § Layers and borders). The layer list lives once, in layers.json.
const serverSrc = "apps/server/src";
const layersFile = path.resolve(__dirname, serverSrc, "modules/layers.json");
const borders = JSON.parse(readFileSync(layersFile, "utf8"));

// One zone per ordered module pair: a permitted pair may import only the index.ts, a forbidden pair nothing.
// The rule resolves each import to a file, so it also catches `import type`, `export … from` and `import()`.
function borderZones() {
  const layerOf = new Map(borders.layers.flatMap((names, index) => names.map((name) => [name, index])));
  const folders = readdirSync(path.resolve(__dirname, serverSrc, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const missing = folders.filter((name) => !layerOf.has(name));
  if (missing.length > 0) {
    throw new Error(`Modules without a layer in ${layersFile}: ${missing.join(", ")}`);
  }
  // Edges between layers only go down, so a cycle between modules can only run through same-layer edges.
  // The lint refuses such a cycle here, so `bun run lint` fails on it even when both imports are listed.
  const next = new Map();
  for (const { from, to } of borders.sameLayerEdges) next.set(from, [...(next.get(from) ?? []), to]);
  const reaches = (start, goal, seen = new Set()) =>
    (next.get(start) ?? []).some((to) => to === goal || (!seen.has(to) && (seen.add(to), reaches(to, goal, seen))));
  const cyclic = borders.sameLayerEdges.find(({ from }) => reaches(from, from));
  if (cyclic) {
    throw new Error(`sameLayerEdges in ${layersFile} has a cycle through ${cyclic.from}`);
  }
  const sameLayer = new Set(borders.sameLayerEdges.map(({ from, to }) => `${from}>${to}`));
  const moduleDir = (name) => `${serverSrc}/modules/${name}`;
  // Globs only: a `from` list that mixes globs and plain paths is an error of the rule.
  const roots = [`${serverSrc}/*.ts`, `${serverSrc}/scripts/**`, `${serverSrc}/start/**`];
  const zones = [];
  for (const [name, layer] of layerOf) {
    for (const [other, otherLayer] of layerOf) {
      if (other === name) continue;
      const permitted = otherLayer < layer || sameLayer.has(`${name}>${other}`);
      zones.push(
        permitted
          ? {
              target: moduleDir(name),
              from: moduleDir(other),
              except: ["./index.ts"],
              message: `Import ${other} only through its index.ts.`,
            }
          : {
              target: moduleDir(name),
              from: moduleDir(other),
              message: `${name} may not import ${other}: it is in a higher layer, or in the same layer without a sameLayerEdges entry (apps/server/src/modules/layers.json).`,
            }
      );
    }
    zones.push({
      target: moduleDir(name),
      from: roots,
      message: "A module never imports a composition root or a script.",
    });
    zones.push({
      target: [`${serverSrc}/*.ts`, `${serverSrc}/scripts/**/*.ts`, `${serverSrc}/start/**/*.ts`],
      from: moduleDir(name),
      except: ["./index.ts"],
      message: `Import ${name} only through its index.ts.`,
    });
  }
  zones.push({
    target: `${serverSrc}/platform`,
    from: [`${serverSrc}/modules/**`, ...roots],
    message: "platform imports no module and no composition root.",
  });
  // CLI output (platform/cli.ts) is for scripts only. One zone per target: a `from` list that mixes globs and plain paths is an error of the rule.
  for (const target of [`${serverSrc}/modules`, `${serverSrc}/platform`, `${serverSrc}/*.ts`, `${serverSrc}/start`]) {
    zones.push({
      target,
      from: `${serverSrc}/platform/cli.ts`,
      message:
        "Only scripts print CLI output (platform/cli.ts); other server code logs events (docs/code-patterns.md § Logs).",
    });
  }
  zones.push({ target: "packages", from: "apps", message: "packages never import apps." });
  return zones;
}

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strict, tseslint.configs.stylistic],
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
  },
});

const webFiles = ["apps/web/**/*.{js,jsx,ts,tsx,astro}"];
const webScriptFiles = ["apps/web/**/*.{js,jsx,ts,tsx}"];

const jsxA11yConfig = tseslint.config({
  files: webScriptFiles,
  extends: [jsxA11y.flatConfigs.recommended],
  languageOptions: {
    ...jsxA11y.flatConfigs.recommended.languageOptions,
  },
  rules: {
    ...jsxA11y.flatConfigs.recommended.rules,
  },
});

const reactConfig = tseslint.config({
  files: webScriptFiles,
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

// The docs app has .astro components too (apps/docs): the plugin must be registered for them, or its `**/*.astro` configs fail.
const astroFiles = [...webFiles, "apps/docs/**/*.astro"];
const astroConfig = eslintPluginAstro.configs["flat/recommended"].map((config) => ({
  ...config,
  files: config.files ?? astroFiles,
}));

const nodeConfig = tseslint.config({
  files: ["apps/server/**/*.ts", "packages/**/*.ts", "tools/**/*.ts"],
  plugins: {
    import: eslintPluginImport,
  },
  languageOptions: {
    globals: {
      ...globals.node,
    },
  },
  settings: {
    "import/resolver": {
      typescript: {
        project: ["apps/server/tsconfig.json", "packages/*/tsconfig.json", "tools/*/tsconfig.json"],
      },
    },
  },
  rules: {
    "prefer-const": "error",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "import/order": [
      "error",
      {
        groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
  },
});

const grammyImports = {
  group: ["grammy", "grammy/*"],
  message: "Only apps/server/src/modules/channels/telegram/ imports grammy (D17, ADR 0005).",
};
const geminiImports = {
  group: ["@google/genai", "@google/genai/*"],
  message: "Only apps/server/src/platform/llm/providers/gemini.ts imports @google/genai (ADR 0014).",
};
const openaiImports = {
  // "!./openai" lets providers/index.ts import its sibling file.
  group: ["openai", "openai/*", "!./openai"],
  message: "Only apps/server/src/platform/llm/providers/openai.ts imports openai (ADR 0014).",
};
const ssoImports = {
  group: ["@better-auth/sso", "@better-auth/sso/*"],
  message: "Only apps/server/src/platform/auth-sso.ts imports @better-auth/sso (F119).",
};
const mailSdkImports = {
  group: ["imapflow", "imapflow/*", "mailparser", "mailparser/*", "nodemailer", "nodemailer/*"],
  message:
    "Only apps/server/src/modules/mail/, modules/lab/ (the sim GreenMail client and bots) and platform/auth-mail.ts import imapflow, mailparser or nodemailer (docs/code-patterns.md § Ports and adapters).",
};
// Flat config: a later block replaces the rule options, so each file group lists all its patterns.
const restrictImports = (patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

// File size (docs/code-patterns.md § Size and shape). The core `max-lines` rule warns over 400 lines; the same rule under the
// name `size/max-lines-hard` fails over 800. Both count every line, as `wc -l` does. Test code is under the rule too.
const sizePlugin = { rules: { "max-lines-hard": builtinRules.get("max-lines") } };
const sizeFiles = ["**/*.{ts,tsx,astro,js,mjs}"];
const sizeOptions = (max) => ({ max, skipBlankLines: false, skipComments: false });

// Log lines are events (ADR 0024, docs/code-patterns.md § Logs). This is the only no-restricted-syntax rule for
// server files: flat config replaces the options of a rule, so a second block with this rule would drop these selectors.
// A log call is `log.info(...)`, `mailboxLog.info(...)`, a member logger (`this.log.info(...)`, `deps.mailboxLog.info(...)`)
// or a call on a chain: `log.with({ ... }).info(...)`. The lint reads names only: a logger under another name passes.
const logLevels = "(debug|info|warn|error)";
const logCall = `:matches(CallExpression[callee.type="MemberExpression"][callee.object.name=/^(log|[a-z][A-Za-z0-9]*Log)$/][callee.property.name=/^${logLevels}$/], CallExpression[callee.type="MemberExpression"][callee.object.type="CallExpression"][callee.object.callee.property.name="with"][callee.property.name=/^${logLevels}$/], CallExpression[callee.type="MemberExpression"][callee.object.type="MemberExpression"][callee.object.property.name=/^(log|[a-z][A-Za-z0-9]*Log)$/][callee.property.name=/^${logLevels}$/])`;
const logEventMessage =
  'Log lines are events: log.<level>("event_code", { allow-listed fields }) (ADR 0024, docs/code-patterns.md § Logs).';
const logEventSelectors = [
  { selector: `${logCall} > :first-child:not(Literal[value=/^[a-z][a-z0-9_]{0,63}$/])`, message: logEventMessage },
  { selector: `${logCall}[arguments.length>2]`, message: `${logEventMessage} At most two arguments.` },
  { selector: `${logCall}[arguments.length=0]`, message: `${logEventMessage} The event code is missing.` },
  {
    // The second argument is an object literal or a call of errorFields / telegramErrorFields. A variable or any other
    // expression hides its fields from the lint (the runtime filter still applies).
    selector: `${logCall}[arguments.length=2] > :nth-child(2):not(ObjectExpression, CallExpression[callee.name=/^(errorFields|telegramErrorFields)$/])`,
    message: `${logEventMessage} The fields are an object literal or ...errorFields(error).`,
  },
  {
    selector: `${logCall} > ObjectExpression MemberExpression[property.name="message"]`,
    message: `${logEventMessage} Never error.message: use ...errorFields(error).`,
  },
];

// CLI standard (docs/cli.md): a tool returns its exit code to `runCli` and prints through `createCliOutput`. The two exit sites
// (`platform/cli.ts`, outside `scripts/`, and `tools/fake-telegram/src/cli-run.ts`) are the only files outside the rule.
const cliExitMessage = "Exit and raw output: runCli and createCliOutput (docs/cli.md).";
// `no-restricted-properties` matches only a bare identifier as the object, so it cannot see `process.stdout.write`: selectors do.
const cliProcessSelectors = [
  { selector: 'MemberExpression[object.name="process"][property.name="exit"]', message: cliExitMessage },
  {
    selector:
      'MemberExpression[object.object.name="process"][object.property.name=/^(stdout|stderr)$/][property.name="write"]',
    message: cliExitMessage,
  },
];

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      "**/dist/**",
      "apps/web/.astro/**",
      "apps/server/src/platform/db/schema.ts",
      // Limen hook stubs (`limen init`): package code, kept as Limen writes it.
      ".pi/**",
      ".omp/**",
    ],
  },
  baseConfig,
  jsxA11yConfig,
  reactConfig,
  ...astroConfig,
  nodeConfig,
  {
    files: [`${serverSrc}/**/*.ts`, "packages/**/*.ts"],
    // Tests assemble modules like a composition root; the e2e seed scripts write test rows with a repository.
    ignores: ["**/*.test.ts", ...borders.rootDeepImportExceptions.map(({ file }) => `${serverSrc}/${file}`)],
    rules: { "import/no-restricted-paths": ["error", { basePath: __dirname, zones: borderZones() }] },
  },
  {
    // Log lines are events (ADR 0024, docs/code-patterns.md § Logs). Tests call invalid forms on purpose (platform/log.test.ts).
    files: ["apps/server/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-syntax": ["error", ...logEventSelectors], "no-console": "error" },
  },
  {
    files: [`${serverSrc}/scripts/**/*.ts`],
    ignores: ["**/*.test.ts"],
    // Flat config replaces the options of a rule: the server scripts keep the log-line selectors.
    rules: { "no-restricted-syntax": ["error", ...logEventSelectors, ...cliProcessSelectors] },
  },
  {
    files: ["tools/*/src/**/*.ts"],
    ignores: ["**/*.test.ts", "tools/fake-telegram/src/cli-run.ts"],
    rules: { "no-restricted-syntax": ["error", ...cliProcessSelectors] },
  },
  {
    // One time spelling: MINUTE_MS, HOUR_MS and DAY_MS from the core time module. Test code is in too.
    // Later local rules join tools/eslint-rules/index.js; a block registers the one `ea` object (a second object fails).
    files: [
      "{apps,packages,tools}/*/src/**/*.{ts,tsx,js,mjs}",
      "**/*.{test.{ts,tsx},spec.ts,test-helper.ts}",
      "{apps/server/test,apps/*/e2e,tools/*/test,deploy/test}/**",
    ],
    ignores: [
      "packages/core/src/time.ts",
      "packages/core/src/time.test.ts", // it pins the three values
    ],
    plugins: { ea },
    rules: { "ea/no-time-literals": "error" },
  },
  {
    // One locale type (docs/code-patterns.md § Texts carry a locale). `ea` is registered here too: the block above has no `.astro`.
    files: ["{apps/docs,apps/web,apps/server,packages/core}/src/**/*.{ts,tsx,astro}"],
    ignores: [
      "**/*.{test,test-helper}.{ts,tsx}",
      "packages/core/src/tenancy.ts", // the one list; then the mail-language folders
      "{packages/core/src/{sim,testmail,outgoing,replies,triage},apps/server/src/modules/{loops,replies,actions,triage}}/**",
    ],
    plugins: { ea },
    rules: { "ea/no-locale-union": "error" },
  },
  {
    files: ["apps/server/src/**/*.ts", "packages/**/*.ts"],
    ignores: [
      "apps/server/src/modules/channels/telegram/**",
      "apps/server/src/platform/llm/providers/gemini*.ts",
      "apps/server/src/platform/llm/providers/openai*.ts",
      "apps/server/src/platform/auth-sso.ts",
    ],
    rules: restrictImports([grammyImports, geminiImports, openaiImports, ssoImports, mailSdkImports]),
  },
  {
    files: ["apps/server/src/platform/auth-sso.ts"],
    rules: restrictImports([grammyImports, geminiImports, openaiImports, mailSdkImports]),
  },
  {
    files: ["apps/server/src/modules/channels/telegram/**/*.ts"],
    rules: restrictImports([geminiImports, openaiImports, ssoImports, mailSdkImports]),
  },
  {
    // The mail adapters, the sim GreenMail client and bots of the lab, and the auth mail sender use the mail SDKs.
    files: [
      "apps/server/src/modules/mail/**/*.ts",
      "apps/server/src/modules/lab/**/*.ts",
      "apps/server/src/platform/auth-mail.ts",
    ],
    rules: restrictImports([grammyImports, geminiImports, openaiImports, ssoImports]),
  },
  {
    files: [
      "apps/server/src/platform/llm/providers/gemini.ts",
      "apps/server/src/platform/llm/providers/gemini.test.ts",
    ],
    rules: restrictImports([grammyImports, openaiImports, ssoImports, mailSdkImports]),
  },
  {
    files: [
      "apps/server/src/platform/llm/providers/openai.ts",
      "apps/server/src/platform/llm/providers/openai.test.ts",
    ],
    rules: restrictImports([grammyImports, geminiImports, ssoImports, mailSdkImports]),
  },
  {
    // components/ui/** is excluded on purpose: the shadcn CLI writes sr-only texts there.
    files: [
      "apps/web/src/islands/**/*.tsx",
      "apps/web/src/components/shell/**/*.tsx",
      "apps/web/src/components/auth/**/*.tsx",
      "apps/web/src/components/mailboxes/**/*.tsx",
      "apps/web/src/components/telegram/**/*.tsx",
      "apps/web/src/components/onboarding/**/*.tsx",
      "apps/web/src/components/settings/**/*.tsx",
      "apps/web/src/components/rules/**/*.tsx",
      "apps/web/src/components/activity/**/*.tsx",
    ],
    rules: {
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true, allowedStrings: ["·", "—", "/"] }],
    },
  },
  {
    files: sizeFiles,
    plugins: { size: sizePlugin },
    rules: { "max-lines": ["warn", sizeOptions(400)], "size/max-lines-hard": ["error", sizeOptions(800)] },
  },
  {
    files: ["apps/web/src/env.d.ts"],
    rules: { "@typescript-eslint/no-empty-object-type": "off" },
  },
  eslintPluginPrettier
);
