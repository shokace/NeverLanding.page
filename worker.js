const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CRAWL_INFO_URL = "https://index.commoncrawl.org/collinfo.json";
const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";
// CDX supports prefix matching on SURT-formatted hostnames (e.g., com,aa).
const SURT_TLDS = ["com"];

let cachedCrawl = null;

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, OPTIONS");
  headers.set("access-control-allow-headers", "*");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function randomPrefix() {
  const len = 2 + Math.floor(Math.random() * 2);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return out;
}

async function getLatestCrawl() {
  const now = Date.now();
  if (cachedCrawl && now - cachedCrawl.fetchedAt < CACHE_TTL_MS) {
    return cachedCrawl;
  }

  const res = await fetch(CRAWL_INFO_URL, { cf: { cacheTtl: 3600 } });
  if (!res.ok) {
    throw new Error("Failed to fetch crawl info");
  }
  const info = await res.json();
  if (!Array.isArray(info) || info.length === 0) {
    throw new Error("Crawl info empty");
  }

  const latest = info.reduce((best, item) => {
    if (!best) return item;
    return String(item.id) > String(best.id) ? item : best;
  }, null);

  if (!latest || !latest.id || !latest["cdx-api"]) {
    throw new Error("Crawl info malformed");
  }

  cachedCrawl = {
    id: latest.id,
    api: latest["cdx-api"],
    fetchedAt: now,
  };

  return cachedCrawl;
}

async function fetchRandomUrl(crawl) {
  const attempts = 6;
  for (let i = 0; i < attempts; i += 1) {
    const prefix = randomPrefix();
    const tld = SURT_TLDS[Math.floor(Math.random() * SURT_TLDS.length)];
    const surtPrefix = `${tld},${prefix}`;
    const query = encodeURIComponent(surtPrefix);
    const url = `${crawl.api}?url=${query}&matchType=prefix&output=json&limit=50&filter=status:200&filter=mime:text/html`;
    const res = await fetch(url, { cf: { cacheTtl: 60 } });
    if (!res.ok) {
      continue;
    }
    const text = await res.text();
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      continue;
    }
    const records = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj && obj.url) records.push(obj);
      } catch {
        // ignore parse errors
      }
    }
    if (records.length === 0) {
      continue;
    }
    const pick = records[Math.floor(Math.random() * records.length)];
    if (pick && pick.url) {
      return pick.url;
    }
  }
  return null;
}

export default {
  async fetch(request) {
    const { method, url } = request;
    const { pathname } = new URL(url);

    if (method === "OPTIONS") {
      return jsonResponse({ ok: true }, { status: 204 });
    }

    if (method !== "GET" || pathname !== "/api/random") {
      return jsonResponse({ error: "Not found" }, { status: 404 });
    }

    try {
      const crawl = await getLatestCrawl();
      const randomUrl = await fetchRandomUrl(crawl);
      if (!randomUrl) {
        return jsonResponse({ error: "No URL found" }, { status: 502 });
      }
      const body = {
        url: randomUrl,
        crawl: crawl.id,
        source: "Common Crawl CDX",
        at: new Date().toISOString(),
      };
      return jsonResponse(body, {
        status: 200,
        headers: {
          "cache-control": "public, max-age=1",
        },
      });
    } catch (err) {
      return jsonResponse({ error: "Upstream failure" }, { status: 502 });
    }
  },
};
