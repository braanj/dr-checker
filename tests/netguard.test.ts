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
