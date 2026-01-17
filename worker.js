const LIST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LIST_META_URL = "https://tranco-list.eu/api/lists/date/latest";
const DNS_FILTER_TTL_MS = 24 * 60 * 60 * 1000;
const DNS_FILTER_URL = "https://family.cloudflare-dns.com/dns-query";

let cachedList = null;
let urlQueue = [];
let dnsCache = new Map();

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

async function resolveListUrl(env) {
  if (env && env.TRANCO_URL) {
    return { listUrl: env.TRANCO_URL, listId: "custom" };
  }

  const res = await fetch(LIST_META_URL, { cf: { cacheTtl: 6 * 60 * 60 } });
  if (!res.ok) {
    throw new Error("Failed to fetch Tranco list metadata");
  }
  const data = await res.json();
  if (!data || !data.download) {
    throw new Error("Tranco metadata missing download URL");
  }
  return { listUrl: data.download, listId: data.list_id || "latest" };
}

async function loadDomainList(listUrl) {
  const now = Date.now();
  if (cachedList && now - cachedList.fetchedAt < LIST_TTL_MS) {
    return cachedList;
  }

  const res = await fetch(listUrl, {
    cf: { cacheTtl: 24 * 60 * 60 },
    headers: {
      "user-agent": "random-website-worker/1.0",
      accept: "text/csv",
    },
  });
  
  if (!res.ok) {
    throw new Error("Failed to fetch Tranco list");
  }

  const text = await res.text();
  const lines = text.split("\n");
  const domains = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",");
    if (parts.length < 2) continue;
    const domain = parts[1].trim();
    if (domain) domains.push(domain);
  }

  if (domains.length === 0) {
    throw new Error("Tranco list empty");
  }

  cachedList = {
    domains,
    fetchedAt: now,
  };

  return cachedList;
}

function pickRandomUrl(domains) {
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `https://${domain}`;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function allowsEmbedding(headers) {
  const xfo = (headers.get("x-frame-options") || "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin") || xfo.includes("allow-from")) {
    return false;
  }

  const csp = (headers.get("content-security-policy") || "").toLowerCase();
  if (csp.includes("frame-ancestors")) {
    if (csp.includes("frame-ancestors 'none'")) return false;
    if (!csp.includes("frame-ancestors *")) return false;
  }

  return true;
}

async function isUrlReachable(url) {
  try {
    const head = await fetchWithTimeout(
      url,
      { method: "HEAD", redirect: "follow" },
      4000
    );
    if (head.ok && allowsEmbedding(head.headers)) return true;
  } catch {}

  try {
    const get = await fetchWithTimeout(
      url,
      {
        method: "GET",
        redirect: "follow",
        headers: { Range: "bytes=0-0" },
      },
      5000
    );
    return get.ok && allowsEmbedding(get.headers);
  } catch {
    return false;
  }
}

async function passesDnsFilter(domain, env) {
  const mode = (env && env.DNS_FILTER) || "family";
  if (mode === "off") return true;

  const now = Date.now();
  const cached = dnsCache.get(domain);
  if (cached && now - cached.at < DNS_FILTER_TTL_MS) {
    return cached.ok;
  }

  try {
    const url = `${DNS_FILTER_URL}?name=${encodeURIComponent(domain)}&type=A`;
    const res = await fetch(url, {
      cf: { cacheTtl: 6 * 60 * 60 },
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) throw new Error("DNS filter fetch failed");

    const data = await res.json();
    const answers = Array.isArray(data.Answer) ? data.Answer : [];
    const ok =
      data.Status === 0 &&
      answers.some((answer) => {
        if (answer.type !== 1) return false;
        const ip = String(answer.data || "").trim();
        return ip && ip !== "0.0.0.0" && ip !== "127.0.0.1";
      });

    dnsCache.set(domain, { ok, at: now });
    return ok;
  } catch {
    return true;
  }
}

async function fillQueue(env, minSize = 1, maxAttempts = 12) {
  if (urlQueue.length >= minSize) return;
  const { listUrl, listId } = await resolveListUrl(env);
  const list = await loadDomainList(listUrl);
  let attempts = 0;

  while (urlQueue.length < minSize && attempts < maxAttempts) {
    attempts += 1;
    const candidate = pickRandomUrl(list.domains);
    const hostname = new URL(candidate).hostname;
    const dnsOk = await passesDnsFilter(hostname, env);
    if (!dnsOk) continue;
    const ok = await isUrlReachable(candidate);
    if (ok) {
      urlQueue.push({ url: candidate, listId });
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const { method, url } = request;
    const { pathname } = new URL(url);

    if (method === "OPTIONS") {
      return jsonResponse({ ok: true }, { status: 204 });
    }

    if (method !== "GET" || pathname !== "/api/random") {
      return jsonResponse({ error: "Not found" }, { status: 404 });
    }

    try {
      await fillQueue(env, 1);
      const queued = urlQueue.shift();
      if (ctx) ctx.waitUntil(fillQueue(env, 2));
      if (!queued) {
        return jsonResponse({ error: "No URL found" }, { status: 502 });
      }
      const body = {
        url: queued.url,
        crawl: `tranco-${queued.listId}`,
        source: "Tranco Top 1M",
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
