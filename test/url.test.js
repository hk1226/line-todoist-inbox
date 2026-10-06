import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTitle, fetchPageTitle, isPublicAddress, withPageTitle } from "../lib/url.js";

test("prefers og:title and decodes entities", () => {
  const html = `<head><meta property="og:title" content="記事 &#12304;速報&#12305; &amp; 解説"><title>サイト名</title></head>`;
  assert.equal(extractTitle(html), "記事 【速報】 & 解説");
});

test("falls back to <title> and collapses whitespace", () => {
  assert.equal(extractTitle("<title>\n  YouTube   動画\n</title>"), "YouTube 動画");
});

test("returns null when the page has no title", () => {
  assert.equal(extractTitle("<html><body>no title</body></html>"), null);
});

test("a bare link becomes 読む：<title>", async () => {
  const item = await withPageTitle({ title: "https://a.example/x", note: "", memo: false }, async () => "良い記事");
  assert.deepEqual(item, { title: "読む：良い記事", note: "https://a.example/x", memo: false });
});

test("text next to a link stays the title and the page title goes into the note", async () => {
  const item = await withPageTitle({ title: "明日 これ読む https://a.example/x", note: "", memo: false }, async () => "良い記事");
  assert.deepEqual(item, { title: "明日 これ読む", note: "良い記事\nhttps://a.example/x", memo: false });
});

test("an unreachable page falls back to the host name", async () => {
  const item = await withPageTitle({ title: "https://news.example.com/a", note: "メモ", memo: false }, async () => null);
  assert.deepEqual(item, { title: "読む：news.example.com", note: "メモ\nhttps://news.example.com/a", memo: false });
});

test("items without a link are untouched", async () => {
  const item = { title: "牛乳", note: "", memo: false };
  assert.equal(await withPageTitle(item, async () => assert.fail("should not fetch")), item);
});

// --- SSRF guard ---------------------------------------------------------------

test("isPublicAddress rejects non-public ranges and accepts public ones", () => {
  const blocked = [
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255",
    "127.0.0.1", "127.8.9.10", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.255.255.250",
    "240.0.0.1", "255.255.255.255",
    "::", "::1", "[::1]", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%en0", "febf::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "", "not-an-ip", "1.2.3", "256.1.1.1", "1:2:3:4:5:6:7:8:9", undefined,
  ];
  const allowed = [
    "93.184.216.34", "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.0", "172.15.255.255",
    "172.32.0.0", "169.253.255.255", "198.17.255.255", "198.20.0.0", "223.255.255.255",
    "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34", "[2001:4860:4860::8888]",
  ];
  for (const address of blocked) assert.equal(isPublicAddress(address), false, `${address} should be blocked`);
  for (const address of allowed) assert.equal(isPublicAddress(address), true, `${address} should be allowed`);
});

const DNS = {
  "public.example": ["93.184.216.34"],
  "other.example": ["2606:2800:220:1:248:1893:25c8:1946"],
  "local.example": ["127.0.0.1"],
  "intranet.example": ["10.1.2.3"],
  "metadata.example": ["169.254.169.254"],
  "mixed.example": ["93.184.216.34", "192.168.0.10"],
};

function fakeLookup(calls = []) {
  return async (host, options) => {
    calls.push(host);
    assert.deepEqual(options, { all: true });
    if (/^[\d.]+$/.test(host)) return [{ address: host, family: 4 }];
    if (host.includes(":")) return [{ address: host, family: 6 }];
    const addresses = DNS[host];
    if (!addresses) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

function htmlResponse(html, init = {}) {
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
}

function redirectResponse(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

const realFetch = globalThis.fetch;

// Replaces globalThis.fetch for one test; `routes` maps a URL to a Response factory.
function mockFetch(t, routes) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const route = routes[String(url)];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  return requests;
}

test("hosts resolving to private, loopback or metadata addresses are never fetched", async (t) => {
  const requests = mockFetch(t, {});
  const lookup = fakeLookup();
  for (const url of [
    "http://local.example/",
    "http://intranet.example/admin",
    "http://metadata.example/latest/meta-data/",
    "http://mixed.example/",
    "http://127.0.0.1:8080/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://0x7f.1/",
    "http://localhost.invalid/",
  ]) {
    assert.equal(await fetchPageTitle(url, { lookup }), null, url);
  }
  assert.equal(requests.length, 0);
});

test("bracketed IPv6 literals are looked up without brackets", async (t) => {
  mockFetch(t, {});
  const calls = [];
  assert.equal(await fetchPageTitle("http://[::1]:3000/x", { lookup: fakeLookup(calls) }), null);
  assert.deepEqual(calls, ["::1"]);
});

test("non-http schemes return null without lookup or fetch", async (t) => {
  const requests = mockFetch(t, {});
  const calls = [];
  for (const url of ["file:///etc/passwd", "ftp://public.example/file", "data:text/html,<title>x</title>", "javascript:alert(1)", "not a url"]) {
    assert.equal(await fetchPageTitle(url, { lookup: fakeLookup(calls) }), null, url);
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(calls, []);
});

test("a public page returns its title and requests use manual redirects", async (t) => {
  const requests = mockFetch(t, {
    "https://public.example/a": () => htmlResponse("<title>公開ページ</title>"),
  });
  assert.equal(await fetchPageTitle("https://public.example/a", { lookup: fakeLookup() }), "公開ページ");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.redirect, "manual");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
});

test("a redirect to another public host is followed, resolving relative locations", async (t) => {
  const calls = [];
  const requests = mockFetch(t, {
    "https://public.example/short": () => redirectResponse("https://other.example/start", 301),
    "https://other.example/start": () => redirectResponse("../final?x=1", 302),
    "https://other.example/final?x=1": () => htmlResponse("<title>転送先</title>"),
  });
  assert.equal(await fetchPageTitle("https://public.example/short", { lookup: fakeLookup(calls) }), "転送先");
  assert.deepEqual(
    requests.map((r) => r.url),
    ["https://public.example/short", "https://other.example/start", "https://other.example/final?x=1"],
  );
  assert.deepEqual(calls, ["public.example", "other.example", "other.example"]);
});

test("a redirect from a public host to a private host is refused", async (t) => {
  for (const location of [
    "http://local.example/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://metadata.example/",
  ]) {
    const requests = mockFetch(t, {
      "https://public.example/r": () => redirectResponse(location, 307),
    });
    assert.equal(await fetchPageTitle("https://public.example/r", { lookup: fakeLookup() }), null, location);
    assert.equal(requests.length, 1, location);
  }
});

test("a redirect to a non-http scheme is refused", async (t) => {
  const requests = mockFetch(t, {
    "https://public.example/r": () => redirectResponse("file:///etc/passwd"),
  });
  assert.equal(await fetchPageTitle("https://public.example/r", { lookup: fakeLookup() }), null);
  assert.equal(requests.length, 1);
});

test("more than three redirects return null", async (t) => {
  const requests = mockFetch(t, {
    "https://public.example/0": () => redirectResponse("/1"),
    "https://public.example/1": () => redirectResponse("/2"),
    "https://public.example/2": () => redirectResponse("/3"),
    "https://public.example/3": () => redirectResponse("/4"),
    "https://public.example/4": () => htmlResponse("<title>遠すぎ</title>"),
  });
  assert.equal(await fetchPageTitle("https://public.example/0", { lookup: fakeLookup() }), null);
  assert.equal(requests.length, 4);
});

test("exactly three redirects are still followed", async (t) => {
  mockFetch(t, {
    "https://public.example/0": () => redirectResponse("/1"),
    "https://public.example/1": () => redirectResponse("/2"),
    "https://public.example/2": () => redirectResponse("/3"),
    "https://public.example/3": () => htmlResponse("<title>ちょうど3回</title>"),
  });
  assert.equal(await fetchPageTitle("https://public.example/0", { lookup: fakeLookup() }), "ちょうど3回");
});

test("a body larger than the cap is read only partially and the title is still found", async (t) => {
  let pulled = 0;
  const chunk = new TextEncoder().encode("<p>" + "x".repeat(64 * 1024) + "</p>");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<html><head><title>大きいページ</title></head><body>"));
    },
    pull(controller) {
      pulled += chunk.byteLength;
      if (pulled > 50 * 1024 * 1024) return controller.error(new Error("read far past the cap"));
      controller.enqueue(chunk);
    },
  });
  mockFetch(t, {
    "https://public.example/big": () => new Response(body, { headers: { "content-type": "text/html" } }),
  });
  assert.equal(await fetchPageTitle("https://public.example/big", { lookup: fakeLookup() }), "大きいページ");
  assert.ok(pulled < 2 * 1024 * 1024, `pulled ${pulled} bytes`);
});

test("non-html, error statuses, DNS failures and fetch errors return null", async (t) => {
  mockFetch(t, {
    "https://public.example/json": () => new Response("{}", { headers: { "content-type": "application/json" } }),
    "https://public.example/404": () => htmlResponse("<title>Not found</title>", { status: 404 }),
    "https://public.example/boom": () => {
      throw new TypeError("network down");
    },
  });
  const lookup = fakeLookup();
  assert.equal(await fetchPageTitle("https://public.example/json", { lookup }), null);
  assert.equal(await fetchPageTitle("https://public.example/404", { lookup }), null);
  assert.equal(await fetchPageTitle("https://public.example/boom", { lookup }), null);
  assert.equal(await fetchPageTitle("https://nowhere.example/", { lookup }), null);
});

test("withPageTitle still works with one argument through the guarded fetch", async (t) => {
  const requests = mockFetch(t, {});
  const item = await withPageTitle({ title: "http://127.0.0.1/secret", note: "", memo: false });
  assert.deepEqual(item, { title: "読む：127.0.0.1", note: "http://127.0.0.1/secret", memo: false });
  assert.equal(requests.length, 0);
});
