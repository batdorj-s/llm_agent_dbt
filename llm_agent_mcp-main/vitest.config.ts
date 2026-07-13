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
                statements: 80,
                branches: 80,
                functions: 80,
                lines: 80,
            },
        },
    },
});
