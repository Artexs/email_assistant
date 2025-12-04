import js from "@eslint/js";
import eslintPluginImport from "eslint-plugin-import";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  eslintPluginPrettier,
  {
    plugins: {
      import: eslintPluginImport,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    settings: {
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      "no-console": "warn",
      "no-unused-vars": "off",
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
  },
  {
    ignores: ["dist/"],
  }
);
