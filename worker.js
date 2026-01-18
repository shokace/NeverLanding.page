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
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "*");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function readCookie(request, name) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return "";
  const parts = cookie.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  if (!match) return "";
  return match.slice(name.length + 1);
}

function base64FromBytes(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64FromBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hashPassword(password, saltBase64 = "") {
  const encoder = new TextEncoder();
  const salt = saltBase64 ? bytesFromBase64(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const iterations = 100000;
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return {
    hash: base64FromBytes(new Uint8Array(derived)),
    salt: base64FromBytes(salt),
    algo: `pbkdf2-sha256-${iterations}`,
  };
}

function setSessionCookie(headers, token, maxAgeSeconds, requestUrl) {
  const secure = requestUrl.protocol === "https:";
  const attributes = [
    `nl_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  headers.append("set-cookie", attributes.join("; "));
}

function setTemporaryCookie(headers, name, value, maxAgeSeconds, requestUrl) {
  const secure = requestUrl.protocol === "https:";
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  headers.append("set-cookie", attributes.join("; "));
}

function clearCookie(headers, name, requestUrl) {
  const secure = requestUrl.protocol === "https:";
  const attributes = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attributes.push("Secure");
  headers.append("set-cookie", attributes.join("; "));
}

function clearSessionCookie(headers, requestUrl) {
  clearCookie(headers, "nl_session", requestUrl);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
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

const SESSION_TTL_DAYS = 30;

async function createSession(env, userId) {
  const token = randomToken(32);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES (?, ?, ?, ?)"
  )
    .bind(sessionId, userId, token, expiresAt)
    .run();
  return { token, expiresAt };
}

async function getUserFromSession(env, token) {
  if (!token) return null;
  const result = await env.DB.prepare(
    `SELECT users.id, users.email, users.username, users.display_name, users.avatar_url\n     FROM sessions\n     JOIN users ON users.id = sessions.user_id\n     WHERE sessions.session_token = ? AND sessions.expires_at > datetime('now')`
  )
    .bind(token)
    .first();
  return result || null;
}

export default {
  async fetch(request, env, ctx) {
    const { method, url } = request;
    const { pathname } = new URL(url);

    if (method === "OPTIONS") {
      return jsonResponse({ ok: true }, { status: 204 });
    }

    if (pathname.startsWith("/api/auth/")) {
      if (!env || !env.DB) {
        return jsonResponse({ error: "Database not configured" }, { status: 500 });
      }

      if (pathname === "/api/auth/register" && method === "POST") {
        const body = await readJson(request);
        if (!body) return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
        const email = String(body.email || "").trim().toLowerCase();
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const displayName = String(body.displayName || "").trim();
        if (!email || !username || !password) {
          return jsonResponse({ error: "Email, username, and password required" }, { status: 400 });
        }
        if (password.length < 8) {
          return jsonResponse({ error: "Password must be at least 8 characters" }, { status: 400 });
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ? OR username = ?"
        )
          .bind(email, username)
          .first();
        if (existing) {
          return jsonResponse({ error: "Email or username already in use" }, { status: 409 });
        }

        const userId = crypto.randomUUID();
        const { hash, salt, algo } = await hashPassword(password);
        await env.DB.prepare(
          `INSERT INTO users (id, email, username, display_name, password_hash, password_salt, password_algo, password_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind(userId, email, username, displayName || null, hash, salt, algo)
          .run();

        const session = await createSession(env, userId);
        const headers = new Headers();
        setSessionCookie(headers, session.token, SESSION_TTL_DAYS * 24 * 60 * 60, new URL(url));
        return jsonResponse(
          { user: { id: userId, email, username, displayName: displayName || null } },
          { status: 201, headers }
        );
      }

      if (pathname === "/api/auth/login" && method === "POST") {
        const body = await readJson(request);
        if (!body) return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!email || !password) {
          return jsonResponse({ error: "Email and password required" }, { status: 400 });
        }
        const user = await env.DB.prepare(
          "SELECT id, email, username, display_name, password_hash, password_salt FROM users WHERE email = ?"
        )
          .bind(email)
          .first();
        if (!user || !user.password_hash || !user.password_salt) {
          return jsonResponse({ error: "Invalid credentials" }, { status: 401 });
        }
        const { hash } = await hashPassword(password, user.password_salt);
        if (hash !== user.password_hash) {
          return jsonResponse({ error: "Invalid credentials" }, { status: 401 });
        }

        const session = await createSession(env, user.id);
        const headers = new Headers();
        setSessionCookie(headers, session.token, SESSION_TTL_DAYS * 24 * 60 * 60, new URL(url));
        return jsonResponse(
          {
            user: {
              id: user.id,
              email: user.email,
              username: user.username,
              displayName: user.display_name || null,
            },
          },
          { status: 200, headers }
        );
      }

      if (pathname === "/api/auth/logout" && method === "POST") {
        const token = readCookie(request, "nl_session");
        if (token) {
          await env.DB.prepare("DELETE FROM sessions WHERE session_token = ?").bind(token).run();
        }
        const headers = new Headers();
        clearSessionCookie(headers, new URL(url));
        return jsonResponse({ ok: true }, { status: 200, headers });
      }

      if (pathname === "/api/auth/me" && method === "GET") {
        const token = readCookie(request, "nl_session");
        const user = await getUserFromSession(env, token);
        return jsonResponse({ user }, { status: 200 });
      }

      if (pathname === "/api/auth/providers" && method === "GET") {
        const providers = providerEnv(env);
        return jsonResponse(
          {
            providers: {
              google: Boolean(providers.google.clientId && providers.google.clientSecret),
              facebook: Boolean(providers.facebook.clientId && providers.facebook.clientSecret),
              email: true,
            },
          },
          { status: 200 }
        );
      }

      if (method === "GET") {
        const providers = providerEnv(env);
        if (pathname === "/api/auth/google") {
          if (!providers.google.clientId || !providers.google.clientSecret) {
            return jsonResponse({ error: "Google OAuth not configured" }, { status: 501 });
          }
          const requestUrl = new URL(url);
          const state = randomToken(16);
          const redirectUri = `${getBaseUrl(requestUrl)}/api/auth/google/callback`;
          const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
          authUrl.searchParams.set("client_id", providers.google.clientId);
          authUrl.searchParams.set("redirect_uri", redirectUri);
          authUrl.searchParams.set("response_type", "code");
          authUrl.searchParams.set("scope", "openid email profile");
          authUrl.searchParams.set("access_type", "offline");
          authUrl.searchParams.set("prompt", "select_account");
          authUrl.searchParams.set("state", state);
          const headers = new Headers();
          setTemporaryCookie(headers, "nl_oauth_state", state, 600, requestUrl);
          return redirectResponse(authUrl.toString(), { headers });
        }
        if (pathname === "/api/auth/github") {
          if (!providers.github.clientId || !providers.github.clientSecret) {
            return jsonResponse({ error: "GitHub OAuth not configured" }, { status: 501 });
          }
          return redirectResponse("/");
        }
        if (pathname === "/api/auth/facebook") {
          if (!providers.facebook.clientId || !providers.facebook.clientSecret) {
            return jsonResponse({ error: "Facebook OAuth not configured" }, { status: 501 });
          }
          return redirectResponse("/");
        }
      }

      if (pathname === "/api/auth/google/callback" && method === "GET") {
        const requestUrl = new URL(url);
        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        const storedState = readCookie(request, "nl_oauth_state");
        if (!code || !state || state !== storedState) {
          return jsonResponse({ error: "Invalid OAuth state" }, { status: 400 });
        }

        const providers = providerEnv(env);
        const redirectUri = `${getBaseUrl(requestUrl)}/api/auth/google/callback`;
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: providers.google.clientId,
            client_secret: providers.google.clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) {
          return jsonResponse({ error: "Google token exchange failed" }, { status: 502 });
        }
        const tokenData = await tokenRes.json();
        const profile = await fetchGoogleProfile(tokenData.access_token);
        const providerUserId = String(profile.sub || "");
        const email = String(profile.email || "").toLowerCase();
        const displayName = String(profile.name || "");
        const avatarUrl = String(profile.picture || "");
        if (!providerUserId) {
          return jsonResponse({ error: "Google profile missing id" }, { status: 502 });
        }

        const existingAccount = await env.DB.prepare(
          "SELECT user_id FROM auth_accounts WHERE provider = ? AND provider_user_id = ?"
        )
          .bind("google", providerUserId)
          .first();

        let userId = existingAccount ? existingAccount.user_id : null;
        if (!userId) {
          const usernameBase = email.split("@")[0] || displayName || "user";
          const username = await ensureUniqueUsername(env, usernameBase);
          userId = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO users (id, email, username, display_name, avatar_url) VALUES (?, ?, ?, ?, ?)"
          )
            .bind(userId, email || null, username, displayName || null, avatarUrl || null)
            .run();
          await env.DB.prepare(
            "INSERT INTO auth_accounts (id, user_id, provider, provider_user_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
            .bind(
              crypto.randomUUID(),
              userId,
              "google",
              providerUserId,
              tokenData.access_token || null,
              tokenData.refresh_token || null,
              tokenData.expires_in
                ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
                : null
            )
            .run();
        }

        const session = await createSession(env, userId);
        const headers = new Headers();
        clearCookie(headers, "nl_oauth_state", requestUrl);
        setSessionCookie(headers, session.token, SESSION_TTL_DAYS * 24 * 60 * 60, requestUrl);
        return redirectResponse("/", { headers });
      }

      return jsonResponse({ error: "Not found" }, { status: 404 });
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
function redirectResponse(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("location", url);
  return new Response(null, {
    ...init,
    status: init.status || 302,
    headers,
  });
}

function providerEnv(env) {
  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
    facebook: {
      clientId: env.FACEBOOK_CLIENT_ID,
      clientSecret: env.FACEBOOK_CLIENT_SECRET,
    },
  };
}

function getBaseUrl(requestUrl) {
  return `${requestUrl.protocol}//${requestUrl.host}`;
}

async function ensureUniqueUsername(env, base) {
  const normalized = base.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "user";
  let candidate = normalized.slice(0, 24);
  let suffix = 0;
  while (true) {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(candidate)
      .first();
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${normalized.slice(0, 20)}${suffix}`.slice(0, 24);
  }
}

async function fetchGoogleProfile(accessToken) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Google userinfo failed");
  return res.json();
}
