import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const denoGlobals = {
  Deno: "readonly",
  globalThis: "readonly",
};

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": ["error", { "allowShortCircuit": true, "allowTernary": true }],
      "no-empty": ["warn", { "allowEmptyCatch": true }],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-useless-escape": "warn",
      "no-constant-binary-expression": "warn",
      "prefer-const": "warn",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...denoGlobals,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["warn", { "allowEmptyCatch": true }],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-useless-escape": "warn",
      "no-constant-binary-expression": "warn",
      "prefer-const": "warn",
    },
  },
);
