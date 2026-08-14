import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/tests/**/*.test.ts"],
        globals: true,
        env: { NODE_ENV: "test", ALLOW_DEV_AUTH: "true" },
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            thresholds: {
                statements: 60,
                branches: 50,
                functions: 60,
                lines: 60,
            },
        },
    },
});
