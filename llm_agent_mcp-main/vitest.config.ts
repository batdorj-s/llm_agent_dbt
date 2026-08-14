import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/tests/**/*.test.ts"],
        globals: true,
        // Each file in its own process: many tests mutate process.env at
        // module load (JWT_SECRET, API keys, NODE_ENV) — the threads pool
        // shared process.env across concurrently running files and produced
        // intermittent 401/403/404 flakes (e.g. finance-mapper-permissions).
        pool: "forks",
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
