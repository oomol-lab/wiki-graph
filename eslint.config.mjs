import { fileURLToPath } from "url";

import eslint from "@eslint/js";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "packages/*/dist/**",
      ".worktrees/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      quotes: [
        "error",
        "double",
        {
          allowTemplateLiterals: "never",
          avoidEscape: true,
        },
      ],
    },
  },
  {
    files: ["packages/*/src/**/*.{js,mjs,ts}"],
    rules: {
      "no-console": "error",
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        {
          ignoreArrowShorthand: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        {
          accessibility: "explicit",
        },
      ],
      "@typescript-eslint/parameter-properties": [
        "error",
        {
          prefer: "class-property",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value=/^node:/]",
          message: 'Do not use the "node:" protocol in imports.',
        },
        {
          selector: "ExportAllDeclaration[source.value=/^node:/]",
          message: 'Do not use the "node:" protocol in exports.',
        },
        {
          selector: "ExportNamedDeclaration[source.value=/^node:/]",
          message: 'Do not use the "node:" protocol in exports.',
        },
        {
          selector:
            "ImportDeclaration[source.value=/^(\\.\\.?\\/)(?!.*\\.js$).+/]",
          message: 'Relative imports must include the ".js" extension.',
        },
        {
          selector:
            "ExportAllDeclaration[source.value=/^(\\.\\.?\\/)(?!.*\\.js$).+/]",
          message: 'Relative exports must include the ".js" extension.',
        },
        {
          selector:
            "ExportNamedDeclaration[source.value=/^(\\.\\.?\\/)(?!.*\\.js$).+/]",
          message: 'Relative exports must include the ".js" extension.',
        },
        {
          selector: "PropertyDefinition[accessibility='private']",
          message: "Use #private fields instead of the private keyword.",
        },
        {
          selector: "MethodDefinition[accessibility='private']",
          message: "Use #private members instead of the private keyword.",
        },
        {
          selector: "TSParameterProperty[accessibility='private']",
          message: "Do not use private parameter properties.",
        },
      ],
    },
  },
  prettierConfig,
);
