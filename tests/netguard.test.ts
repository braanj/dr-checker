import { describe, it, expect } from "vitest";
import { isBlockedAddress } from "../supabase/functions/fetch-meta/netguard";

describe("isBlockedAddress", () => {
  it("blocks every private/reserved IPv4 range", () => {
    for (const ip of [
      "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254",
      "172.16.0.1", "172.31.255.255", "192.168.1.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    ]) expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("allows public IPv4, including the edges just outside blocked ranges", () => {
    for (const ip of ["8.8.8.8", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "223.255.255.255"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("blocks IPv6 loopback, unspecified, ULA, link-local, multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fdff::1", "fe80::1", "febf::1", "ff02::1", "[::1]", "fe80::1%eth0"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("blocks IPv4-mapped, IPv4-compatible and NAT64 forms of blocked IPv4", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("allows public IPv6 and mapped public IPv4", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("fails closed on garbage", () => {
    for (const ip of ["", "example.com", "1.2.3", "1.2.3.256", "1::2::3", "gggg::1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });
});

describe("isBlockedAddress — extra ranges from the review", () => {
  it("blocks IETF/benchmark/documentation IPv4 ranges", () => {
    for (const ip of ["192.0.0.1", "198.18.0.1", "198.19.255.255", "192.0.2.1", "198.51.100.1", "203.0.113.1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("blocks deprecated site-local and local-use NAT64 IPv6", () => {
    for (const ip of ["fec0::1", "feff::1", "64:ff9b:1::1"]) expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("blocks 6to4 and Teredo addresses that embed a private IPv4", () => {
    expect(isBlockedAddress("2002:7f00:0001::1"), "6to4 127.0.0.1").toBe(true);
    expect(isBlockedAddress("2002:0a00:0001::1"), "6to4 10.0.0.1").toBe(true);
    // Teredo: client IPv4 is the last 32 bits, XOR 0xffff
    expect(isBlockedAddress("2001:0:4136:e378:8000:63bf:80ff:fffe"), "teredo → 127.0.0.1").toBe(true);
  });

  it("still allows public addresses next to the new ranges", () => {
    for (const ip of ["192.0.1.1", "198.17.255.255", "198.20.0.1", "2002:0808:0808::1", "2001:4860:4860::8888"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });
});
