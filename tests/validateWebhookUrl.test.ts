import { describe, it, expect } from "vitest";
import { validateWebhookUrl } from "../server/utils/validateWebhookUrl.js";

describe("validateWebhookUrl", () => {
  it("accepts a valid public https URL", () => {
    expect(validateWebhookUrl("https://example.com/hook")).toBeNull();
  });

  it("accepts a valid public http URL", () => {
    expect(validateWebhookUrl("http://api.example.org/webhook")).toBeNull();
  });

  it("rejects non-http/https protocols", () => {
    expect(validateWebhookUrl("ftp://example.com/hook")).not.toBeNull();
    expect(validateWebhookUrl("file:///etc/passwd")).not.toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(validateWebhookUrl("not-a-url")).not.toBeNull();
    expect(validateWebhookUrl("")).not.toBeNull();
  });

  it("rejects localhost", () => {
    expect(validateWebhookUrl("http://localhost/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://LOCALHOST/hook")).not.toBeNull();
  });

  it("rejects 127.x.x.x loopback", () => {
    expect(validateWebhookUrl("http://127.0.0.1/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://127.1.2.3/hook")).not.toBeNull();
  });

  it("rejects 0.0.0.0", () => {
    expect(validateWebhookUrl("http://0.0.0.0/hook")).not.toBeNull();
  });

  it("rejects RFC-1918 10.x.x.x", () => {
    expect(validateWebhookUrl("http://10.0.0.1/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://10.255.255.255/hook")).not.toBeNull();
  });

  it("rejects RFC-1918 172.16-31.x.x", () => {
    expect(validateWebhookUrl("http://172.16.0.1/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://172.31.255.255/hook")).not.toBeNull();
  });

  it("does not block 172.15.x.x or 172.32.x.x (outside private range)", () => {
    expect(validateWebhookUrl("http://172.15.0.1/hook")).toBeNull();
    expect(validateWebhookUrl("http://172.32.0.1/hook")).toBeNull();
  });

  it("rejects RFC-1918 192.168.x.x", () => {
    expect(validateWebhookUrl("http://192.168.1.1/hook")).not.toBeNull();
  });

  it("rejects link-local 169.254.x.x (IMDS)", () => {
    expect(validateWebhookUrl("http://169.254.169.254/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://169.254.0.1/hook")).not.toBeNull();
  });

  it("rejects IPv6 loopback ::1", () => {
    expect(validateWebhookUrl("http://[::1]/hook")).not.toBeNull();
  });

  it("rejects IPv6 link-local fe80::", () => {
    expect(validateWebhookUrl("http://[fe80::1]/hook")).not.toBeNull();
  });

  it("rejects IPv6 ULA fc::/7 — fc prefix", () => {
    expect(validateWebhookUrl("http://[fc00::1]/hook")).not.toBeNull();
  });

  it("rejects IPv6 ULA fc::/7 — fd prefix (common private range)", () => {
    expect(validateWebhookUrl("http://[fd12:3456:789a::1]/hook")).not.toBeNull();
  });

  it("rejects metadata.google.internal", () => {
    expect(validateWebhookUrl("http://metadata.google.internal/hook")).not.toBeNull();
  });
});
