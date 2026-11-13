import { includeIgnoreFile } from "@eslint/compat";
import eslint from "@eslint/js";
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
  const roots = [`${serverSrc}/*.ts`, `${serverSrc}/scripts/**`];
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
      target: [`${serverSrc}/*.ts`, `${serverSrc}/scripts/**/*.ts`],
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

const astroConfig = eslintPluginAstro.configs["flat/recommended"].map((config) => ({
  ...config,
  files: config.files ?? webFiles,
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
// Flat config: a later block replaces the rule options, so each file group lists all its patterns.
const restrictImports = (patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

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
    files: ["apps/server/src/**/*.ts", "packages/**/*.ts"],
    ignores: [
      "apps/server/src/modules/channels/telegram/**",
      "apps/server/src/platform/llm/providers/gemini*.ts",
      "apps/server/src/platform/llm/providers/openai*.ts",
    ],
    rules: restrictImports([grammyImports, geminiImports, openaiImports]),
  },
  {
    files: ["apps/server/src/modules/channels/telegram/**/*.ts"],
    rules: restrictImports([geminiImports, openaiImports]),
  },
  {
    files: [
      "apps/server/src/platform/llm/providers/gemini.ts",
      "apps/server/src/platform/llm/providers/gemini.test.ts",
    ],
    rules: restrictImports([grammyImports, openaiImports]),
  },
  {
    files: [
      "apps/server/src/platform/llm/providers/openai.ts",
      "apps/server/src/platform/llm/providers/openai.test.ts",
    ],
    rules: restrictImports([grammyImports, geminiImports]),
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
    files: ["apps/web/src/env.d.ts"],
    rules: { "@typescript-eslint/no-empty-object-type": "off" },
  },
  eslintPluginPrettier
);
