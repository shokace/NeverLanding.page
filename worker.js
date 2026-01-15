const LIST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LIST_META_URL = "https://tranco-list.eu/api/lists/date/latest";

let cachedList = null;

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

export default {
  async fetch(request, env) {
    const { method, url } = request;
    const { pathname } = new URL(url);

    if (method === "OPTIONS") {
      return jsonResponse({ ok: true }, { status: 204 });
    }

    if (method !== "GET" || pathname !== "/api/random") {
      return jsonResponse({ error: "Not found" }, { status: 404 });
    }

    try {
      const { listUrl, listId } = await resolveListUrl(env);
      const list = await loadDomainList(listUrl);
      const randomUrl = pickRandomUrl(list.domains);
      const body = {
        url: randomUrl,
        crawl: `tranco-${listId}`,
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
