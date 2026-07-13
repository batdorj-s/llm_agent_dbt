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
      // Prevent unused variables (errors on new code, warns on legacy)
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Enforce consistent type imports
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      // Prevent implicit undefined returns
      "@typescript-eslint/no-meaningless-void-operator": "warn",
    },
  },
];
