import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/tests/**/*.test.ts"],
        globals: true,
        env: { NODE_ENV: "test" },
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            thresholds: {
                statements: 55,
                branches: 45,
                functions: 55,
                lines: 55,
            },
        },
    },
});
