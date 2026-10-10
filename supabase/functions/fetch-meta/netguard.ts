// Address guard for outbound metadata fetches (ADR 0003). Every resolved
// address of every request hop must pass. Unparseable input fails closed.

function parseIPv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

function blockedV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18/15
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast 224/4, reserved 240/4, broadcast
  );
}

function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail: number[] = [];
  if (s.includes(".")) {
    // dotted IPv4 tail (::ffff:1.2.3.4, ::1.2.3.4, 64:ff9b::10.0.0.1) → two hextets
    const idx = s.lastIndexOf(":");
    const v4 = parseIPv4(s.slice(idx + 1));
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    const prefix = s.slice(0, idx + 1);
    s = prefix.endsWith("::") ? prefix : s.slice(0, idx);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const hex = (part: string) =>
    part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN));
  const head = hex(halves[0]);
  const rest = halves.length === 2 ? hex(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  const count = head.length + rest.length + tail.length;
  if (halves.length === 1) return count === 8 ? [...head, ...tail] : null;
  if (count > 7) return null;
  return [...head, ...new Array(8 - count).fill(0), ...rest, ...tail];
}

function blockedV6(h: number[]): boolean {
  const embeddedV4 = [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff];
  const firstFiveZero = h.slice(0, 5).every((x) => x === 0);
  if (h.every((x) => x === 0)) return true; // ::
  if (firstFiveZero && h[5] === 0xffff) return blockedV4(embeddedV4); // ::ffff:a.b.c.d
  if (firstFiveZero && h[5] === 0) return true; // ::1 and IPv4-compatible ::a.b.c.d (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return blockedV4(embeddedV4); // NAT64
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return true; // local-use NAT64 64:ff9b:1::/48
  if (h[0] === 0x2002) return blockedV4([h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff]); // 6to4
  if (h[0] === 0x2001 && h[1] === 0) {
    // Teredo: the client IPv4 is the last 32 bits, XOR 0xffffffff
    const x6 = h[6] ^ 0xffff;
    const x7 = h[7] ^ 0xffff;
    return blockedV4([x6 >> 8, x6 & 0xff, x7 >> 8, x7 & 0xff]);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((h[0] & 0xffc0) === 0xfec0) return true; // deprecated site-local fec0::/10
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return blockedV4(v4);
  if (!ip.includes(":")) return true;
  const v6 = parseIPv6(ip);
  return v6 ? blockedV6(v6) : true;
}
