import { describe, it, expect, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { buildSslConfig } from "../db/data-lake.js";

const LOCAL_URLS = [
    "postgresql://user:pass@127.0.0.1:5432/db",
    "postgresql://user:pass@localhost:5432/db",
    "postgresql://user:pass@host.docker.internal:5432/db",
];

const REMOTE_URLS = [
    "postgresql://user:pass@db.example.com:5432/db",
    "postgresql://user:pass@ec2-54-123-45-67.compute-1.amazonaws.com:5432/db",
    "postgresql://user:pass@supabase.co:5432/postgres",
    "postgresql://user:pass@db.12345678.digitalocean.com:25060/db",
    "postgresql://user:pass@10.0.0.5:5432/db",
];

describe("buildSslConfig", () => {
    const savedPgSslRootCert = process.env.PGSSLROOTCERT;

    beforeEach(() => {
        delete process.env.PGSSLROOTCERT;
    });

    afterAll(() => {
        if (savedPgSslRootCert !== undefined) {
            process.env.PGSSLROOTCERT = savedPgSslRootCert;
        } else {
            delete process.env.PGSSLROOTCERT;
        }
    });

    it.each(LOCAL_URLS)("returns false for local URL: %s", (url) => {
        expect(buildSslConfig(url)).toBe(false);
    });

    it.each(REMOTE_URLS)("returns ssl config with rejectUnauthorized: true for remote URL: %s", (url) => {
        const result = buildSslConfig(url);
        expect(result).not.toBe(false);
        expect(result).toHaveProperty("rejectUnauthorized", true);
    });

    it("sets ca from PGSSLROOTCERT when file exists", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssl-test-"));
        const certPath = path.join(tmpDir, "ca.pem");
        const fakeCert = "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----";
        fs.writeFileSync(certPath, fakeCert, "utf8");
        process.env.PGSSLROOTCERT = certPath;
        try {
            const result = buildSslConfig(REMOTE_URLS[0]) as any;
            expect(result.ca).toBe(fakeCert);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it("omits ca when PGSSLROOTCERT is not set", () => {
        const result = buildSslConfig(REMOTE_URLS[0]) as any;
        expect(result.ca).toBeUndefined();
    });

    it("omits ca when PGSSLROOTCERT is empty string", () => {
        process.env.PGSSLROOTCERT = "";
        const result = buildSslConfig(REMOTE_URLS[0]) as any;
        expect(result.ca).toBeUndefined();
    });
});
