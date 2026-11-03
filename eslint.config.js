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
  files: ["apps/server/**/*.ts", "packages/**/*.ts"],
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
        project: ["apps/server/tsconfig.json", "packages/*/tsconfig.json"],
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

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  { ignores: ["**/dist/**", "apps/web/.astro/**", "apps/server/src/platform/db/schema.ts"] },
  baseConfig,
  jsxA11yConfig,
  reactConfig,
  ...astroConfig,
  nodeConfig,
  {
    files: ["apps/web/src/env.d.ts"],
    rules: { "@typescript-eslint/no-empty-object-type": "off" },
  },
  eslintPluginPrettier
);
