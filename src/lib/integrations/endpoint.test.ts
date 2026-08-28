// ═══════════════════════════════════════════════════════════════
// Webhook endpoints: where the server may be told to connect
// ═══════════════════════════════════════════════════════════════
// The dangerous property of this feature is that a human types a URL and the
// *server* fetches it. "Only an administrator can set it" is not the control
// people take it for: the request originates inside the deployment, so it
// reaches things no browser on the outside can — above all the cloud metadata
// service, which hands instance credentials to anything that asks it from
// inside.
//
// Each case below is a real technique rather than a variation on a theme.

import { describe, it, expect } from "vitest";
import { checkEndpoint, blockedAddressReason } from "./endpoint";

/** DNS that answers whatever the test says, so no case depends on real DNS. */
const resolvesTo = (...addresses: string[]) => async () => addresses;

describe("scheme and shape", () => {
  it("refuses plain http", async () => {
    const result = await checkEndpoint("http://hooks.example.com/x", resolvesTo("93.184.216.34"));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/https/i);
  });

  it("refuses a non-URL", async () => {
    expect((await checkEndpoint("not a url")).ok).toBe(false);
  });

  it("refuses credentials embedded in the URL", async () => {
    // user:pass@host is also how a URL is made to *look* like it points
    // somewhere it does not.
    const result = await checkEndpoint(
      "https://hooks.example.com:pass@169.254.169.254/latest/meta-data",
      resolvesTo("93.184.216.34"),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts an ordinary public https endpoint", async () => {
    const result = await checkEndpoint("https://hooks.slack.com/services/T/B/x", resolvesTo("93.184.216.34"));
    expect(result.ok).toBe(true);
    expect(result.pinnedAddress).toBe("93.184.216.34");
  });
});

describe("addresses that must never be reachable", () => {
  it("blocks the cloud metadata service", () => {
    // 169.254.169.254 on AWS, GCP and Azure. Reaching it from inside an
    // instance returns credentials.
    expect(blockedAddressReason("169.254.169.254")).toMatch(/link-local|metadata/i);
  });

  it("blocks loopback, private and CGNAT ranges", () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "172.16.4.4", "172.31.255.1", "192.168.1.1", "100.64.0.1"]) {
      expect(blockedAddressReason(address), `${address} must be blocked`).not.toBeNull();
    }
  });

  it("allows a public address", () => {
    for (const address of ["93.184.216.34", "1.1.1.1", "172.15.0.1", "172.32.0.1"]) {
      expect(blockedAddressReason(address), `${address} should be allowed`).toBeNull();
    }
  });

  it("blocks IPv6 loopback, link-local and unique-local", () => {
    for (const address of ["::1", "fe80::1", "fc00::1", "fd12:3456::1"]) {
      expect(blockedAddressReason(address), `${address} must be blocked`).not.toBeNull();
    }
  });

  it("blocks an IPv4 private address wearing an IPv6 mapping", () => {
    // ::ffff:169.254.169.254 reaches the metadata service through a form that
    // no IPv4 string check would ever see.
    expect(blockedAddressReason("::ffff:169.254.169.254")).toMatch(/link-local|metadata/i);
    expect(blockedAddressReason("::ffff:127.0.0.1")).toMatch(/loopback/i);
  });
});

describe("a hostname is not an address", () => {
  it("refuses a public-looking name that resolves somewhere private", async () => {
    // This is the whole reason the host is resolved rather than pattern
    // matched: nothing about the string is suspicious.
    const result = await checkEndpoint(
      "https://webhooks.example.com/notify",
      resolvesTo("169.254.169.254"),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/169\.254\.169\.254/);
  });

  it("refuses when any answer is private, not merely the first", async () => {
    // A host that returns one public and one private address would otherwise
    // pass the check and then connect to the private one.
    const result = await checkEndpoint(
      "https://split.example.com/hook",
      resolvesTo("93.184.216.34", "10.1.2.3"),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/10\.1\.2\.3/);
  });

  it("refuses a bare host with no domain", async () => {
    // `https://intranet/hook` can only be something on the internal network.
    expect((await checkEndpoint("https://intranet/hook")).ok).toBe(false);
  });

  it("refuses a literal private address without consulting DNS", async () => {
    const result = await checkEndpoint("https://10.0.0.1/hook", async () => {
      throw new Error("DNS must not be consulted for a literal address");
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a host that does not resolve", async () => {
    const result = await checkEndpoint("https://nx.example.com/hook", async () => {
      throw new Error("ENOTFOUND");
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/resolved/i);
  });

  it("refuses a host that resolves to nothing", async () => {
    expect((await checkEndpoint("https://empty.example.com/hook", resolvesTo())).ok).toBe(false);
  });
});

describe("rebinding", () => {
  it("pins the address it validated so the name is not resolved twice", async () => {
    // Between the check and the request, DNS can start answering with a
    // private address. Connecting to the validated address rather than
    // re-resolving is what closes that window, so the caller is given one.
    const result = await checkEndpoint("https://hooks.example.com/x", resolvesTo("93.184.216.34"));
    expect(result.ok).toBe(true);
    expect(result.pinnedAddress).toBe("93.184.216.34");
  });
});
