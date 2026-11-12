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
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

// File path setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, ".gitignore");

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
