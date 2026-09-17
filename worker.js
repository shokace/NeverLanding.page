import {randomLanding} from './lib/discovery.js';
import {inspectUrl, publicUrl} from './lib/safety.js';
import {syncAchievements} from './lib/achievements.js';
import {issueVisitReceipt, verifyVisitReceipt} from './lib/visit-receipts.js';
import {leaderboardResponse, isPublicUsername} from './lib/leaderboard.js';

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(init.status === 204 ? null : JSON.stringify(body), {
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
  const limit = 16384;
  if (Number(request.headers.get("content-length")) > limit || !request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) return null;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {return null;}
  finally {await reader.cancel().catch(() => {});}
}

const SESSION_TTL_DAYS = 30;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 8;
const rateLimits = new Map();

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

function allowRateLimit(key) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

async function getUserFromSession(env, token) {
  if (!token) return null;
  const result = await env.DB.prepare(
    `SELECT users.id, users.email, users.username, users.display_name, users.avatar_url\n     FROM sessions\n     JOIN users ON users.id = sessions.user_id\n     WHERE sessions.session_token = ? AND datetime(sessions.expires_at) > datetime('now')`
  )
    .bind(token)
    .first();
  return result ? {...result, needsUsername: !isPublicUsername(result.username)} : null;
}

async function requireUser(env, request, {allowIncomplete = false} = {}) {
  const token = readCookie(request, "nl_session");
  const user = await getUserFromSession(env, token);
  if (!user) {
    return { error: jsonResponse({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (user.needsUsername && !allowIncomplete) return {error:jsonResponse({error:"Choose a username to continue",code:"USERNAME_REQUIRED"},{status:403})};
  return { user };
}

async function grantAchievement(env, userId, code) {
  const achievement = await env.DB.prepare(
    "SELECT id FROM achievements WHERE code = ?"
  )
    .bind(code)
    .first();
  if (!achievement) return;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user_achievements (id, user_id, achievement_id) VALUES (?, ?, ?)"
  )
    .bind(crypto.randomUUID(), userId, achievement.id)
    .run();
}

export default {
  async fetch(request, env, ctx) {
    const { method, url } = request;
    const { pathname } = new URL(url);

    if (method === "POST") {
      const origin = request.headers.get("origin");
      if ((origin && origin !== new URL(url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
        return jsonResponse({error:"Cross-site requests are not allowed"}, {status:403});
      }
      if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) {
        return jsonResponse({error:"JSON is required"}, {status:415});
      }
    }

    if (pathname === "/api/leaderboard" && method === "GET") {
      return leaderboardResponse(env, request, ctx);
    }

    if (method === "OPTIONS") {
      return jsonResponse({ ok: true }, { status: 204 });
    }

    if (pathname === "/api/resolve" && method === "POST") {
      const body = await readJson(request);
      const entry = body && await inspectUrl(body.url);
      if (!entry) return jsonResponse({error: "This page could not pass the safety and preview checks."}, {status: 422});
      return jsonResponse(entry, {headers: {"cache-control": "no-store"}});
    }

    if (pathname === "/api/account" && method === "GET") {
      const auth = await requireUser(env, request, {allowIncomplete:true});
      if (auth.error) return auth.error;
      const account = await env.DB.prepare("SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = ?").bind(auth.user.id).first();
      return jsonResponse({hasPassword:Boolean(account?.has_password)});
    }

    if (pathname === "/api/account/sessions/revoke" && method === "POST") {
      const auth = await requireUser(env, request, {allowIncomplete:true});
      if (auth.error) return auth.error;
      await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND session_token != ?")
        .bind(auth.user.id, readCookie(request, "nl_session")).run();
      return jsonResponse({ok:true});
    }

    if (pathname === "/api/account/delete" && method === "POST") {
      const auth = await requireUser(env, request, {allowIncomplete:true});
      if (auth.error) return auth.error;
      const body = await readJson(request);
      if (body?.confirmation !== "DELETE") return jsonResponse({error:"Type DELETE to confirm."}, {status:400});
      if (!allowRateLimit(`delete:${auth.user.id}`)) return jsonResponse({error:"Please wait a moment and try again."}, {status:429});
      const account = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").bind(auth.user.id).first();
      if (!account) return jsonResponse({error:"Unauthorized"}, {status:401});
      if (account.password_hash) {
        if (typeof body.password !== "string" || !body.password || !account.password_salt) return jsonResponse({error:"Enter your password to delete this account."}, {status:400});
        const {hash} = await hashPassword(body.password, account.password_salt);
        if (hash !== account.password_hash) return jsonResponse({error:"That password is incorrect."}, {status:403});
      } else {
        // A Google-only account must have authenticated within the last ten minutes.
        const recent = await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ? AND session_token = ? AND datetime(created_at) >= datetime('now', '-10 minutes')")
          .bind(auth.user.id, readCookie(request, "nl_session")).first();
        if (!recent) return jsonResponse({error:"Sign in again, then return to Settings to delete your account.",code:"REAUTH_REQUIRED"}, {status:403});
      }
      // One atomic delete; foreign keys cascade to every account-owned table.
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(auth.user.id).run();
      const headers = new Headers();
      clearSessionCookie(headers, new URL(url));
      return jsonResponse({ok:true}, {headers});
    }

    if (["/api/account/username", "/api/account/profile"].includes(pathname) && method === "POST") {
      const auth = await requireUser(env, request, {allowIncomplete:true});
      if (auth.error) return auth.error;
      const body = await readJson(request);
      const username = typeof body?.username === "string" ? body.username.trim() : "";
      if (!isPublicUsername(username) || username.length < 3 || username.length > 24) {
        return jsonResponse({error:"Use 3–24 letters, numbers, underscores, or hyphens. Email addresses are not usernames."}, {status:400});
      }
      const setupOnly = pathname === "/api/account/username";
      if (setupOnly && !auth.user.needsUsername) return jsonResponse({error:"This account already has a username"}, {status:409});
      try {
        const updated = await env.DB.prepare(`UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ? AND (? = 0 OR username IS NULL OR length(username) NOT BETWEEN 1 AND 32 OR username GLOB '*[^A-Za-z0-9_-]*')`)
          .bind(username, auth.user.id, setupOnly ? 1 : 0).run();
        if (!updated.meta.changes) return jsonResponse({error:"This account already has a username"}, {status:409});
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed")) return jsonResponse({error:"That username is already taken. Choose another."}, {status:409});
        return jsonResponse({error:"Your username could not be saved. Please try again."}, {status:503});
      }
      return jsonResponse({username});
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
        if (!isPublicUsername(username) || username.length < 3 || username.length > 24) {
          return jsonResponse({error:"Choose a username of 3–24 letters, numbers, underscores, or hyphens. Do not use an email address."}, {status:400});
        }
        if (password.length < 8) {
          return jsonResponse({ error: "Password must be at least 8 characters" }, { status: 400 });
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ? OR username = ? COLLATE NOCASE"
        )
          .bind(email, username)
          .first();
        if (existing) {
          return jsonResponse({ error: "Email or username already in use" }, { status: 409 });
        }

        const userId = crypto.randomUUID();
        const { hash, salt, algo } = await hashPassword(password);
        try {
          await env.DB.prepare(
          `INSERT INTO users (id, email, username, display_name, password_hash, password_salt, password_algo, password_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind(userId, email, username, displayName || null, hash, salt, algo)
          .run();
        } catch (error) {
          if (String(error).includes("UNIQUE constraint failed")) return jsonResponse({error:"Email or username already in use"}, {status:409});
          return jsonResponse({error:"Sign up is temporarily unavailable"}, {status:503});
        }

        await grantAchievement(env, userId, "login_first");
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

        await grantAchievement(env, user.id, "login_first");
        const session = await createSession(env, user.id);
        const headers = new Headers();
        setSessionCookie(headers, session.token, SESSION_TTL_DAYS * 24 * 60 * 60, new URL(url));
        return jsonResponse(
          {
            user: {
              id: user.id,
              email: user.email,
              username: user.username,
              needsUsername: !isPublicUsername(user.username),
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
        if (user) {
          await grantAchievement(env, user.id, "login_first");
        }
        return jsonResponse({ user }, { status: 200 });
      }

      if (pathname === "/api/auth/providers" && method === "GET") {
        const providers = providerEnv(env);
        return jsonResponse(
          {
            providers: {
              google: Boolean(providers.google.clientId && providers.google.clientSecret),
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
          // Google profile names and email addresses are never public usernames.
          const username = null;
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

        await grantAchievement(env, userId, "login_first");
        const session = await createSession(env, userId);
        const headers = new Headers();
        clearCookie(headers, "nl_oauth_state", requestUrl);
        setSessionCookie(headers, session.token, SESSION_TTL_DAYS * 24 * 60 * 60, requestUrl);
        return redirectResponse("/", { headers });
      }


      return jsonResponse({ error: "Not found" }, { status: 404 });
    }

    if (pathname === "/api/visits" && method === "POST") {
      if (!env || !env.DB) {
        return jsonResponse({ error: "Database not configured" }, { status: 500 });
      }
      const auth = await requireUser(env, request);
      if (auth.error) return auth.error;
      if (!allowRateLimit(auth.user.id)) {
        return jsonResponse({ error: "Too many requests" }, { status: 429 });
      }
      const body = await readJson(request);
      if (!body) return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
      const parsed = publicUrl(String(body.url || ""));
      if (!parsed) return jsonResponse({error: "A public HTTPS URL is required"}, {status: 400});
      const urlValue = parsed.href;
      const receipt = await verifyVisitReceipt(env.VISIT_SIGNING_KEY, body.visitToken, urlValue, auth.user.id);
      if (!receipt) return jsonResponse({error:"A valid landing receipt is required. Reload the game and try again."}, {status:403});
      // Unique receipt IDs and the insert-time limit work across Worker instances.
      const inserted = await env.DB.prepare(`
        INSERT OR IGNORE INTO visits (user_id, url, title, visit_token_id)
        SELECT ?, ?, ?, ? WHERE (
          SELECT COUNT(*) FROM visits WHERE user_id = ? AND visited_at >= datetime('now', '-1 second')
        ) < 8
      `).bind(auth.user.id, urlValue, urlValue, receipt.id, auth.user.id).run();
      if (!inserted.meta.changes) {
        const used = await env.DB.prepare('SELECT 1 AS used FROM visits WHERE visit_token_id = ?').bind(receipt.id).first();
        return jsonResponse({error:used ? "This landing was already counted" : "Too many requests"}, {status:used ? 409 : 429});
      }
      await syncAchievements(env, auth.user.id);
      return jsonResponse({ ok: true }, { status: 201 });
    }

    if (pathname === "/api/favorites" && method === "GET") {
      if (!env || !env.DB) {
        return jsonResponse({ error: "Database not configured" }, { status: 500 });
      }
      const auth = await requireUser(env, request);
      if (auth.error) return auth.error;
      const rows = await env.DB.prepare(
        "SELECT id, url, title, added_at FROM favorites WHERE user_id = ? ORDER BY added_at DESC"
      )
        .bind(auth.user.id)
        .all();
      const items = rows && rows.results ? rows.results : [];
      return jsonResponse({ items }, { status: 200 });
    }

    if (pathname === "/api/favorites" && method === "POST") {
      if (!env || !env.DB) {
        return jsonResponse({ error: "Database not configured" }, { status: 500 });
      }
      const auth = await requireUser(env, request);
      if (auth.error) return auth.error;
      const body = await readJson(request);
      if (!body) return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
      const urlValue = String(body.url || "").trim();
      const titleValue = String(body.title || "").trim();
      if (!urlValue) {
        return jsonResponse({ error: "URL required" }, { status: 400 });
      }
      const existing = await env.DB.prepare(
        "SELECT id FROM favorites WHERE user_id = ? AND url = ?"
      )
        .bind(auth.user.id, urlValue)
        .first();
      if (existing && existing.id) {
        await env.DB.prepare("DELETE FROM favorites WHERE id = ?")
          .bind(existing.id)
          .run();
        return jsonResponse({ favorite: false }, { status: 200 });
      }
      await env.DB.prepare(
        "INSERT INTO favorites (user_id, url, title) VALUES (?, ?, ?)"
      )
        .bind(auth.user.id, urlValue, titleValue || null)
        .run();
      return jsonResponse({ favorite: true }, { status: 201 });
    }

    if (pathname === "/api/progress" && method === "GET") {
      if (!env || !env.DB) {
        return jsonResponse({ error: "Database not configured" }, { status: 500 });
      }
      const auth = await requireUser(env, request);
      if (auth.error) return auth.error;
      const visitsCount = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM visits WHERE user_id = ?"
      )
        .bind(auth.user.id)
        .first();
      const uniqueCount = await env.DB.prepare(
        "SELECT COUNT(DISTINCT url) as count FROM visits WHERE user_id = ?"
      )
        .bind(auth.user.id)
        .first();
      const favoritesCount = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM favorites WHERE user_id = ?"
      )
        .bind(auth.user.id)
        .first();
      return jsonResponse(
        {
          visits: visitsCount ? visitsCount.count : 0,
          uniqueVisits: uniqueCount ? uniqueCount.count : 0,
          favorites: favoritesCount ? favoritesCount.count : 0,
        },
        { status: 200 }
      );
    }

    if (pathname === "/api/achievements/unlocked" && method === "GET") {
      if (!env || !env.DB) {
        return jsonResponse({ error: "Database not configured" }, { status: 500 });
      }
      const auth = await requireUser(env, request);
      if (auth.error) return auth.error;
      await syncAchievements(env, auth.user.id);
      const rows = await env.DB.prepare(
        `SELECT achievements.code as code, user_achievements.source_url as url, user_achievements.earned_at as earnedAt
         FROM user_achievements
         JOIN achievements ON achievements.id = user_achievements.achievement_id
         WHERE user_achievements.user_id = ?`
      )
        .bind(auth.user.id)
        .all();
      const codes = rows && rows.results ? rows.results.map((row) => row.code) : [];
      return jsonResponse({codes, items: rows?.results || []}, {status: 200, headers: {"cache-control": "no-store"}});
    }

    if (pathname === "/api/achievements/share" && method === "POST") {
      if (!env || !env.DB) {
        return jsonResponse({ error: "Database not configured" }, { status: 500 });
      }
      const auth = await requireUser(env, request);
      if (auth.error) return auth.error;
      const body = await readJson(request);
      await syncAchievements(env, auth.user.id, {share: true, shareUrl: publicUrl(body?.url)?.href || null});
      return jsonResponse({ ok: true }, { status: 200 });
    }

    if (method !== "GET" || pathname !== "/api/random") {
      return jsonResponse({ error: "Not found" }, { status: 404 });
    }

    try {
      const excluded = new URL(url).searchParams.getAll("exclude").slice(0, 30);
      const entry = await randomLanding(env, excluded, ctx);
      if (!entry) return jsonResponse({error: "No suitable page found. Please try again."}, {status: 503, headers: {"retry-after": "3", "cache-control": "no-store"}});
      const user = await getUserFromSession(env, readCookie(request, "nl_session"));
      const visitToken = await issueVisitReceipt(env.VISIT_SIGNING_KEY, entry.url, user?.id || null);
      return jsonResponse({...entry, visitToken}, {headers: {"cache-control": "no-store"}});
    } catch {
      return jsonResponse({error: "Discovery is temporarily unavailable."}, {status: 503, headers: {"cache-control": "no-store"}});
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
  };
}

function getBaseUrl(requestUrl) {
  return `${requestUrl.protocol}//${requestUrl.host}`;
}

async function fetchGoogleProfile(accessToken) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Google userinfo failed");
  return res.json();
}
