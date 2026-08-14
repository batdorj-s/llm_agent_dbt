import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { isBlockedIp, assertSafeWebhookUrl } from "../utils/ssrf.js";

vi.mock("dns/promises", () => ({
  lookup: vi.fn(),
}));
import { lookup } from "dns/promises";
const mockLookup = vi.mocked(lookup);

describe("isBlockedIp", () => {
  it("blocks loopback addresses", () => {
    expect(isBlockedIp("127.0.0.1").blocked).toBe(true);
    expect(isBlockedIp("127.0.0.2").blocked).toBe(true);
    expect(isBlockedIp("::1").blocked).toBe(true);
  });

  it("blocks private IPv4 ranges", () => {
    expect(isBlockedIp("10.0.0.5").blocked).toBe(true);
    expect(isBlockedIp("172.16.0.1").blocked).toBe(true);
    expect(isBlockedIp("172.31.255.255").blocked).toBe(true);
    expect(isBlockedIp("172.32.0.1").blocked).toBe(false);
    expect(isBlockedIp("192.168.1.1").blocked).toBe(true);
  });

  it("blocks link-local and metadata addresses", () => {
    expect(isBlockedIp("169.254.169.254").blocked).toBe(true);
    expect(isBlockedIp("169.254.10.10").blocked).toBe(true);
    expect(isBlockedIp("fe80::1").blocked).toBe(true);
  });

  it("blocks private IPv6 (fc00::/7) and unspecified", () => {
    expect(isBlockedIp("fc00::1").blocked).toBe(true);
    expect(isBlockedIp("fd12:3456::1").blocked).toBe(true);
    expect(isBlockedIp("0.0.0.0").blocked).toBe(true);
    expect(isBlockedIp("::").blocked).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isBlockedIp("8.8.8.8").blocked).toBe(false);
    expect(isBlockedIp("1.1.1.1").blocked).toBe(false);
    expect(isBlockedIp("2606:4700::1111").blocked).toBe(false);
  });
});

describe("assertSafeWebhookUrl", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    mockLookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as any);
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafeWebhookUrl("file:///etc/passwd")).rejects.toThrow(/protocol/);
    await expect(assertSafeWebhookUrl("gopher://localhost:6379/x")).rejects.toThrow(/protocol/);
  });

  it("rejects http by default, allows it when allowHttp=true", async () => {
    await expect(assertSafeWebhookUrl("http://hooks.slack.com/x")).rejects.toThrow(/HTTPS/);
    await expect(assertSafeWebhookUrl("http://hooks.slack.com/x", true)).resolves.toBeUndefined();
  });

  it("rejects literal localhost and private IPs", async () => {
    await expect(assertSafeWebhookUrl("https://localhost:9090/x")).rejects.toThrow(/localhost/);
    await expect(assertSafeWebhookUrl("https://127.0.0.1:5432/x")).rejects.toThrow(/blocked/);
    await expect(assertSafeWebhookUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow(/blocked/);
    await expect(assertSafeWebhookUrl("https://10.0.0.5/x")).rejects.toThrow(/blocked/);
  });

  it("rejects malformed URLs", async () => {
    await expect(assertSafeWebhookUrl("not-a-url")).rejects.toThrow(/Invalid webhook URL/);
  });

  it("resolves hostnames and blocks private targets (DNS rebinding defense)", async () => {
    mockLookup.mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
      { address: "10.1.2.3", family: 4 },
    ] as any);
    await expect(assertSafeWebhookUrl("https://evil.example.com/hook")).rejects.toThrow(/blocked/);
  });

  it("allows public hostnames that resolve only to public IPs", async () => {
    mockLookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
    ] as any);
    await expect(assertSafeWebhookUrl("https://hooks.slack.com/hook")).resolves.toBeUndefined();
  });

  it("rejects unresolvable hostnames", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafeWebhookUrl("https://no-such-host.invalid/hook")).rejects.toThrow(/could not be resolved/);
  });
});