import dns from "node:dns/promises";

const URL_PATTERN = /https?:\/\/[^\s<>"'「」）)]+/;
const FETCH_TIMEOUT_MS = 3000;
const TITLE_MAX = 80;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function charsetOf(contentType, head) {
  const fromHeader = contentType.match(/charset=([\w-]+)/i)?.[1];
  const fromMeta = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  return (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
}

export function extractTitle(html) {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1];
  const title = og ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!title) return null;
  const clean = decodeEntities(title).replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean;
}

// --- SSRF guard -------------------------------------------------------------
// The bot fetches URLs that arrive from chat messages, so every request (and every
// redirect hop) is checked: http(s) only, and the host must resolve to public addresses.

const BLOCKED_V4 = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including 255.255.255.255
];

function parseIPv4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n;
}

function isPublicIPv4Number(n) {
  return !BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(n / size) === Math.floor(parseIPv4(base) / size);
  });
}

// Expands an IPv6 string (optionally with a trailing dotted IPv4) into 8 16-bit groups.
function parseIPv6(text) {
  let s = text.replace(/%.*$/, ""); // drop zone id (fe80::1%en0)
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = parseIPv4(v4[2]);
    if (n === null) return null;
    s = `${v4[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part) => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** True only for a syntactically valid IPv4/IPv6 address outside every non-public range. */
export function isPublicAddress(address) {
  if (typeof address !== "string") return false;
  const raw = address.replace(/^\[|\]$/g, "");
  const v4 = parseIPv4(raw);
  if (v4 !== null) return isPublicIPv4Number(v4);

  const g = parseIPv6(raw);
  if (!g) return false; // unparseable: fail closed
  const embeddedV4 = () => g[6] * 65536 + g[7];
  const firstFiveZero = g.slice(0, 5).every((x) => x === 0);
  if (firstFiveZero && g[5] === 0xffff) return isPublicIPv4Number(embeddedV4()); // ::ffff:a.b.c.d (mapped)
  if (firstFiveZero && g[5] === 0) {
    if (g[6] === 0 && g[7] <= 1) return false; // :: and ::1
    return isPublicIPv4Number(embeddedV4()); // ::a.b.c.d (compatible)
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicIPv4Number(embeddedV4()); // 64:ff9b::/96 NAT64
  }
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function isSafeTarget(url, lookup, signal) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return false;
  const addresses = await untilAborted(Promise.resolve(lookup(host, { all: true })), signal);
  const list = Array.isArray(addresses) ? addresses : [addresses];
  return list.length > 0 && list.every((entry) => isPublicAddress(typeof entry === "string" ? entry : entry?.address));
}

async function readCapped(res, limit) {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, limit);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= limit) reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
    if (offset >= bytes.length) break;
  }
  return bytes;
}

/**
 * Fetches a page and returns its title, or null on any failure or refused target.
 * `options.lookup` is injectable for tests. The default reads dns.lookup at call time,
 * so callers that cannot pass options can stub it with mock.method(dns, "lookup", ...).
 */
export async function fetchPageTitle(url, { lookup = (host, opts) => dns.lookup(host, opts) } = {}) {
  try {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let current = new URL(url);
    let res;
    for (let hop = 0; ; hop++) {
      if (!(await isSafeTarget(current, lookup, signal))) return null;
      res = await globalThis.fetch(current.href, {
        redirect: "manual",
        signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; line-todoist-bot)", "accept-language": "ja,en;q=0.8" },
      });
      if (!REDIRECT_STATUSES.has(res.status)) break;
      res.body?.cancel().catch(() => {});
      const location = res.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) return null;
      current = new URL(location, current);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("html")) return null;
    const bytes = await readCapped(res, MAX_BODY_BYTES);
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
    let html;
    try {
      html = new TextDecoder(charsetOf(contentType, head)).decode(bytes);
    } catch {
      html = new TextDecoder("utf-8").decode(bytes);
    }
    return extractTitle(html);
  } catch {
    return null;
  }
}

// A link on the title line becomes "読む：<page title>"; when there is other text, that text stays the title.
export async function withPageTitle(item, fetchTitle = fetchPageTitle) {
  const url = item.title.match(URL_PATTERN)?.[0];
  if (!url) return item;

  const pageTitle = await fetchTitle(url);
  const rest = item.title.replace(url, "").replace(/\s+/g, " ").trim();
  const title = rest || `読む：${pageTitle ?? new URL(url).hostname}`;
  const note = [item.note, rest ? pageTitle : null, url].filter(Boolean).join("\n");
  return { ...item, title, note };
}
