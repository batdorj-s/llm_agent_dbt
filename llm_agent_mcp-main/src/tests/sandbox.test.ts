import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateSandbox, mockExecFile } = vi.hoisted(() => {
    const mockCreateSandbox = vi.fn();
    const mockExecFile = vi.fn();
    return { mockCreateSandbox, mockExecFile };
});

vi.mock("@e2b/code-interpreter", () => ({
    Sandbox: { create: mockCreateSandbox },
}));

vi.mock("child_process", () => ({
    execFile: mockExecFile,
}));

vi.mock("../agents/agentState.js", () => ({
    withTimeout: vi.fn((promise: Promise<any>) => promise),
}));

const CODE = "print('hello')";
let uidCounter = 0;
function uid(): string {
    return `test_${++uidCounter}`;
}

// ── Path selection ───────────────────────────────────────────

describe("runPythonCode — path selection", () => {
    let runPythonCode: any;

    beforeEach(async () => {
        process.env.E2B_API_KEY = "";
        process.env.ALLOW_LOCAL_PYTHON = "";
        process.env.NODE_ENV = "test";
        mockCreateSandbox.mockReset();
        mockExecFile.mockReset();
        const mod = await import("../sandbox.js");
        runPythonCode = mod.runPythonCode;
    });

    afterEach(() => {
        delete process.env.E2B_API_KEY;
        delete process.env.ALLOW_LOCAL_PYTHON;
        process.env.NODE_ENV = "test";
    });

    it("returns informative message when neither E2B nor local configured", async () => {
        const result = await runPythonCode(CODE);
        expect(result).toContain("Python execution unavailable");
        expect(result).toContain("E2B_API_KEY");
        expect(result).toContain("ALLOW_LOCAL_PYTHON");
        expect(mockCreateSandbox).not.toHaveBeenCalled();
    });

    it("uses local path when ALLOW_LOCAL_PYTHON=true and no E2B key", async () => {
        mockExecFile.mockImplementation((_file: string, args: string[], _opts: any, cb: any) => {
            const fs = require("fs");
            fs.writeFileSync(args[0].replace(".py", "_out.txt"), "local result");
            cb(null, "", "");
        });
        process.env.ALLOW_LOCAL_PYTHON = "true";
        const result = await runPythonCode(CODE);
        expect(result).toContain("local result");
        expect(mockExecFile).toHaveBeenCalled();
    });

    it("refuses local execution in production mode", async () => {
        process.env.ALLOW_LOCAL_PYTHON = "true";
        process.env.NODE_ENV = "production";
        mockExecFile.mockReset();
        const result = await runPythonCode(CODE);
        expect(result).toContain("disabled in production");
        expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("uses E2B path when E2B_API_KEY is set", async () => {
        process.env.E2B_API_KEY = "real-key";
        const mockRunCode = vi.fn().mockResolvedValue({
            logs: { stdout: ["e2b result"], stderr: [] },
            error: null,
        });
        mockCreateSandbox.mockResolvedValue({
            runCode: mockRunCode,
            files: { read: vi.fn().mockRejectedValue(new Error("no chart")), write: vi.fn() },
            kill: vi.fn(),
        });
        const result = await runPythonCode(CODE, 5000, false, uid());
        expect(result).toContain("e2b result");
        expect(mockCreateSandbox).toHaveBeenCalled();
    });

    it("treats placeholder E2B_API_KEY as unset", async () => {
        process.env.E2B_API_KEY = "your_e2b_api_key_here";
        mockCreateSandbox.mockReset();
        const result = await runPythonCode(CODE);
        expect(result).toContain("Python execution unavailable");
        expect(mockCreateSandbox).not.toHaveBeenCalled();
    });
});

// ── E2B execution ───────────────────────────────────────────

describe("runPythonCode — E2B execution", () => {
    let runPythonCode: any;
    let mockRunCode: any;
    let mockFilesRead: any;
    let mockFilesWrite: any;

    beforeEach(async () => {
        process.env.E2B_API_KEY = "real-key";
        process.env.ALLOW_LOCAL_PYTHON = "";
        process.env.NODE_ENV = "test";
        mockCreateSandbox.mockReset();
        mockRunCode = vi.fn();
        mockFilesRead = vi.fn();
        mockFilesWrite = vi.fn();
        mockCreateSandbox.mockResolvedValue({
            runCode: mockRunCode,
            files: { read: mockFilesRead, write: mockFilesWrite },
            kill: vi.fn(),
        });
        const mod = await import("../sandbox.js");
        runPythonCode = mod.runPythonCode;
    });

    it("returns stdout on success", async () => {
        mockRunCode.mockResolvedValue({
            logs: { stdout: ["hello world"], stderr: [] },
            error: null,
        });
        const result = await runPythonCode("print('hello')", 5000, false, uid());
        expect(result).toContain("hello world");
    });

    it("includes stderr when present", async () => {
        mockRunCode.mockResolvedValue({
            logs: { stdout: ["some output"], stderr: ["warning: deprecation"] },
            error: null,
        });
        const result = await runPythonCode(CODE, 5000, false, uid());
        expect(result).toContain("some output");
        expect(result).toContain("warning: deprecation");
    });

    it("captures chart from files.read and appends ##CHART_SAVED##", async () => {
        mockRunCode.mockResolvedValue({
            logs: { stdout: ["analysis done"], stderr: [] },
            error: null,
        });
        mockFilesRead.mockResolvedValue(Buffer.from("fake-png-bytes"));
        const result = await runPythonCode(CODE, 5000, false, uid());
        expect(result).toContain("##CHART_SAVED##");
        expect(result).toContain("##BASE64_IMAGE:");
        expect(result).toContain(Buffer.from("fake-png-bytes").toString("base64"));
    });

    it("handles missing chart gracefully — no ##CHART_SAVED##", async () => {
        mockRunCode.mockResolvedValue({
            logs: { stdout: ["no chart here"], stderr: [] },
            error: null,
        });
        mockFilesRead.mockRejectedValue(new Error("File not found"));
        const result = await runPythonCode(CODE, 5000, false, uid());
        expect(result).toContain("no chart here");
        expect(result).not.toContain("##CHART_SAVED##");
    });

    it("returns fallback message on empty output", async () => {
        mockRunCode.mockResolvedValue({
            logs: { stdout: [], stderr: [] },
            error: null,
        });
        const result = await runPythonCode(CODE, 5000, false, uid());
        expect(result).toContain("Execution complete. No output.");
    });

    it("handles E2B execution error — sandbox throws", async () => {
        mockCreateSandbox.mockRejectedValue(new Error("Sandbox creation failed"));
        const result = await runPythonCode(CODE, 5000, false, uid());
        expect(result).toContain("E2B Execution Error");
        expect(result).toContain("Sandbox creation failed");
    });

    it("reuses cached sandbox instance on second call (same userId)", async () => {
        mockRunCode.mockResolvedValue({
            logs: { stdout: ["cached result"], stderr: [] },
            error: null,
        });
        const userId = uid();
        await runPythonCode(CODE, 5000, false, userId);
        await runPythonCode(CODE, 5000, false, userId);
        expect(mockCreateSandbox).toHaveBeenCalledTimes(1);
    });

    it("creates new sandbox for different userId", async () => {
        mockRunCode.mockResolvedValue({
            logs: { stdout: ["ok"], stderr: [] },
            error: null,
        });
        await runPythonCode(CODE, 5000, false, uid());
        await runPythonCode(CODE, 5000, false, uid());
        expect(mockCreateSandbox).toHaveBeenCalledTimes(2);
    });
});

// ── Local execution ─────────────────────────────────────────

describe("runPythonCode — local execution", () => {
    let runPythonCode: any;

    beforeEach(async () => {
        process.env.E2B_API_KEY = "";
        process.env.ALLOW_LOCAL_PYTHON = "true";
        process.env.NODE_ENV = "test";
        mockCreateSandbox.mockReset();
        mockExecFile.mockReset();
        const mod = await import("../sandbox.js");
        runPythonCode = mod.runPythonCode;
    });

    it("returns output from temp file on success", async () => {
        mockExecFile.mockImplementation((_file: string, args: string[], _opts: any, cb: any) => {
            const fs = require("fs");
            fs.writeFileSync(args[0].replace(".py", "_out.txt"), "success result");
            cb(null, "", "");
        });
        const result = await runPythonCode(CODE);
        expect(result).toContain("success result");
    });

    it("includes chart base64 when chart file exists", async () => {
        mockExecFile.mockImplementation((_file: string, args: string[], _opts: any, cb: any) => {
            const fs = require("fs");
            fs.writeFileSync(args[0].replace(".py", "_out.txt"), "chart result");
            fs.writeFileSync(args[0].replace(".py", "_chart.png"), Buffer.from("png-data"));
            cb(null, "", "");
        });
        const result = await runPythonCode(CODE);
        expect(result).toContain("chart result");
        expect(result).toContain("##CHART_SAVED##");
        expect(result).toContain("##BASE64_IMAGE:");
    });

    it("handles execFile failure — throws", async () => {
        mockExecFile.mockImplementation((_file: string, _args: string[], _opts: any, cb: any) => {
            cb(new Error("python3 not found"), "", "python3: command not found");
        });
        await expect(runPythonCode(CODE)).rejects.toThrow();
    });

    it("respects skipMemorySafe flag — code not wrapped", async () => {
        let writtenCode = "";
        mockExecFile.mockImplementation((_file: string, args: string[], _opts: any, cb: any) => {
            const fs = require("fs");
            writtenCode = fs.readFileSync(args[0], "utf8");
            fs.writeFileSync(args[0].replace(".py", "_out.txt"), "result");
            cb(null, "", "");
        });
        await runPythonCode("x = 1", 5000, true);
        expect(writtenCode).not.toContain("_safe_read_csv");
        expect(writtenCode).toContain("x = 1");
    });

    it("includes memory safety wrappers by default", async () => {
        let writtenCode = "";
        mockExecFile.mockImplementation((_file: string, args: string[], _opts: any, cb: any) => {
            const fs = require("fs");
            writtenCode = fs.readFileSync(args[0], "utf8");
            fs.writeFileSync(args[0].replace(".py", "_out.txt"), "result");
            cb(null, "", "");
        });
        await runPythonCode("x = 1", 5000, false);
        expect(writtenCode).toContain("_safe_read_csv");
        expect(writtenCode).toContain("_safe_head");
        expect(writtenCode).toContain("x = 1");
    });
});
