import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("init.ts — execFileSync conversion", () => {
    it("does not import execSync", () => {
        const src = fs.readFileSync(path.join(__dirname, "../setup/init.ts"), "utf8");
        expect(src).not.toContain("execSync");
    });

    it("does not use shell string interpolation for dbt args", () => {
        const src = fs.readFileSync(path.join(__dirname, "../setup/init.ts"), "utf8");
        expect(src).not.toMatch(/runDbt\(`/);
    });

    it("exports runDbtTest as a function", async () => {
        const mod = await import("../setup/init.js");
        expect(typeof mod.runDbtTest).toBe("function");
    });

    it("exports runDbtForTable as a function", async () => {
        const mod = await import("../setup/init.js");
        expect(typeof mod.runDbtForTable).toBe("function");
    });

    it("exports ensureProjectReady as a function", async () => {
        const mod = await import("../setup/init.js");
        expect(typeof mod.ensureProjectReady).toBe("function");
    });
});
