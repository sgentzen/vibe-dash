import { describe, it, expect } from "vitest";
import {
  buildAllowedNetwork,
  isAllowedHost,
  isAllowedOrigin,
  isUpgradeAllowed,
  resolveListenHost,
} from "../server/security/origin.js";

describe("resolveListenHost", () => {
  it("defaults to loopback when HOST is unset (SEC-4)", () => {
    expect(resolveListenHost({})).toBe("127.0.0.1");
  });

  it("honours an explicit HOST opt-in", () => {
    expect(resolveListenHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });
});

describe("buildAllowedNetwork", () => {
  it("always allows the loopback hostnames on the server's own port", () => {
    const network = buildAllowedNetwork(3001);
    expect(isAllowedHost("localhost:3001", network)).toBe(true);
    expect(isAllowedHost("127.0.0.1:3001", network)).toBe(true);
    expect(isAllowedHost("[::1]:3001", network)).toBe(true);
    expect(network.origins.has("http://localhost:3001")).toBe(true);
  });

  it("is case-insensitive on the Host header", () => {
    const network = buildAllowedNetwork(3001);
    expect(isAllowedHost("LOCALHOST:3001", network)).toBe(true);
  });

  it("rejects a loopback hostname on a different port", () => {
    const network = buildAllowedNetwork(3001);
    expect(isAllowedHost("localhost:9999", network)).toBe(false);
  });

  it("rejects an unrelated host by default", () => {
    const network = buildAllowedNetwork(3001);
    expect(isAllowedHost("evil.example.com", network)).toBe(false);
    expect(isAllowedOrigin("http://evil.example.com", network)).toBe(false);
  });

  it("adds VIBE_DASH_ALLOWED_HOSTS entries for both http and https Origins", () => {
    const network = buildAllowedNetwork(3001, { extraHosts: "vibe-dash.example.com, team.internal:8443" });
    expect(isAllowedHost("vibe-dash.example.com", network)).toBe(true);
    expect(isAllowedHost("team.internal:8443", network)).toBe(true);
    expect(network.origins.has("http://vibe-dash.example.com")).toBe(true);
    expect(network.origins.has("https://vibe-dash.example.com")).toBe(true);
  });

  it("ignores blank entries and trims whitespace in the extra-hosts list", () => {
    const network = buildAllowedNetwork(3001, { extraHosts: " , alice.example.com ,, " });
    expect(isAllowedHost("alice.example.com", network)).toBe(true);
    expect(network.hosts.has("")).toBe(false);
  });

  it("only widens to the Vite dev port when includeDevPort is set", () => {
    const prod = buildAllowedNetwork(3001, { includeDevPort: false });
    const dev = buildAllowedNetwork(3001, { includeDevPort: true });
    expect(isAllowedHost("localhost:3000", prod)).toBe(false);
    expect(isAllowedHost("localhost:3000", dev)).toBe(true);
    expect(dev.origins.has("http://localhost:3000")).toBe(true);
  });

  it("combines includeDevPort and extraHosts without either one crowding out the other", () => {
    // The shape server/index.ts actually builds in dev mode with a configured
    // VIBE_DASH_ALLOWED_HOSTS — both options just add to the same allow-list,
    // but that's worth pinning rather than assuming, since it's the one
    // combination the individual-option tests above don't exercise.
    const network = buildAllowedNetwork(3001, {
      extraHosts: "vibe-dash.example.com",
      includeDevPort: true,
    });
    expect(isAllowedHost("localhost:3001", network)).toBe(true);
    expect(isAllowedHost("localhost:3000", network)).toBe(true);
    expect(isAllowedHost("vibe-dash.example.com", network)).toBe(true);
    expect(network.origins.has("https://vibe-dash.example.com")).toBe(true);
  });
});

describe("isAllowedHost", () => {
  it("rejects a missing Host header", () => {
    const network = buildAllowedNetwork(3001);
    expect(isAllowedHost(undefined, network)).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("treats an absent Origin as allowed — non-browser clients never send one", () => {
    const network = buildAllowedNetwork(3001);
    expect(isAllowedOrigin(undefined, network)).toBe(true);
  });

  it("allows an Origin on the allow-list and rejects a foreign one", () => {
    const network = buildAllowedNetwork(3001);
    expect(isAllowedOrigin("http://localhost:3001", network)).toBe(true);
    expect(isAllowedOrigin("http://attacker.example", network)).toBe(false);
  });
});

describe("isUpgradeAllowed", () => {
  const network = buildAllowedNetwork(3001);

  it("allows an upgrade with a valid Host and no Origin", () => {
    expect(isUpgradeAllowed({ headers: { host: "localhost:3001" } } as never, network)).toBe(true);
  });

  it("allows an upgrade with a valid Host and an allowed Origin", () => {
    expect(
      isUpgradeAllowed(
        { headers: { host: "localhost:3001", origin: "http://localhost:3001" } } as never,
        network,
      ),
    ).toBe(true);
  });

  it("rejects an upgrade whose Host is foreign", () => {
    expect(isUpgradeAllowed({ headers: { host: "evil.example.com" } } as never, network)).toBe(false);
  });

  it("rejects an upgrade whose Origin is foreign even with a valid Host (SEC-1)", () => {
    expect(
      isUpgradeAllowed(
        { headers: { host: "localhost:3001", origin: "http://attacker.example" } } as never,
        network,
      ),
    ).toBe(false);
  });
});
