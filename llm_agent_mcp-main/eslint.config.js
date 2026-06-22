import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Block NEW `any` usage. Legacy ~135 violations at "warn" level — fix incrementally.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
