import {publicUrl} from './url.js';
export {publicUrl} from './url.js';
const DNS_URL = 'https://family.cloudflare-dns.com/dns-query';
const BLOCKLIST_URL = 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/nsfw-onlydomains.txt';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const dnsCache = new Map();
const pageCache = new Map();
let blocklist;
let blocklistTask;

export function isPublicIPv4(value) {
  const p = String(value).split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
}

function remember(cache, key, value, ttl) {
  if (cache.size >= 2000) cache.delete(cache.keys().next().value);
  cache.set(key, {value, expires: Date.now() + ttl});
}
function remembered(cache, key) {
  const item = cache.get(key);
  return item && item.expires > Date.now() ? item.value : undefined;
}

export async function boundedFetch(url, init = {}, {timeout = 4000, maxBytes = 131072, budget} = {}) {
  if (budget && budget.remaining-- <= 0) throw new Error('Request budget exhausted');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {...init, signal: controller.signal});
    const reader = response.body?.getReader();
    let size = 0;
    const chunks = [];
    if (reader) {
      try {
        while (size < maxBytes) {
          const {done, value} = await reader.read();
          if (done) break;
          const chunk = value.subarray(0, maxBytes - size);
          chunks.push(chunk); size += chunk.length;
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return {response, text: new TextDecoder().decode(bytes)};
  } finally { clearTimeout(timer); }
}

async function getBlocklist() {
  if (blocklist && Date.now() - blocklist.at < EIGHT_HOURS) return blocklist.domains;
  if (!blocklistTask) {
    blocklistTask = (async () => {
      const {response, text} = await boundedFetch(BLOCKLIST_URL, {cf: {cacheTtl: 3600}}, {maxBytes: 4_000_000, timeout: 5000});
      if (!response.ok || text.length >= 4_000_000) throw new Error('Adult filter unavailable');
      const domains = new Set(text.split(/\r?\n/).map(s => s.trim()).filter(s => /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(s)));
      if (domains.size < 1000) throw new Error('Incomplete adult filter');
      blocklist = {domains, at: Date.now()};
      return domains;
    })().finally(() => { blocklistTask = null; });
  }
  // No unchecked fallback when either filtering service fails.
  return blocklistTask;
}

export function blockedHost(host, domains) {
  const parts = host.split('.');
  if (['xxx', 'porn', 'sex', 'adult', 'sexy'].includes(parts.at(-1))) return true;
  if (/(?:porn|hentai|xvideos|xnxx|xhamster|onlyfans|chaturbate|stripchat|redtube|youporn)/i.test(host)) return true;
  for (let i = 0; i < parts.length - 1; i++) if (domains.has(parts.slice(i).join('.'))) return true;
  return false;
}

async function familyDns(host, budget) {
  const cached = remembered(dnsCache, host);
  if (cached !== undefined) return cached;
  try {
    const {response, text} = await boundedFetch(`${DNS_URL}?name=${encodeURIComponent(host)}&type=A`,
      {headers: {accept: 'application/dns-json'}, cf: {cacheTtl: 300}}, {maxBytes: 32768, budget});
    if (!response.ok) return false;
    let data = JSON.parse(text);
    let addresses = (data.Answer || []).filter(a => a.type === 1);
    let ok = data.Status === 0 && addresses.length > 0 && addresses.every(a => isPublicIPv4(a.data));
    if (data.Status === 0 && !addresses.length) {
      const ipv6 = await boundedFetch(`${DNS_URL}?name=${encodeURIComponent(host)}&type=AAAA`,
        {headers: {accept: 'application/dns-json'}, cf: {cacheTtl: 300}}, {maxBytes: 32768, budget});
      if (!ipv6.response.ok) return false;
      data = JSON.parse(ipv6.text);
      addresses = (data.Answer || []).filter(a => a.type === 28);
      ok = data.Status === 0 && addresses.length > 0 && addresses.every(a => /^[23][0-9a-f]{0,3}:/i.test(a.data) && !/^2001:db8:/i.test(a.data));
    }
    remember(dnsCache, host, ok, ok ? 300000 : 60000);
    return ok;
  } catch { return false; }
}

export function allowsEmbedding(headers) {
  if (headers.get('x-frame-options')) return false;
  const csp = headers.get('content-security-policy') || '';
  // Every policy must permit any HTTPS parent. Do not mistake default-src * for permission.
  for (const policy of csp.split(',')) {
    for (const directive of policy.split(';')) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name?.toLowerCase() === 'frame-ancestors' && !sources.some(s => s === '*' || s === 'https:')) return false;
    }
  }
  return true;
}

export function adultPage(html) {
  return /<meta\b[^>]*(?:name\s*=\s*["']?rating["']?[^>]*content\s*=\s*["']?(?:adult|RTA-|restricted)|content\s*=\s*["']?(?:adult|RTA-|restricted)[^>]*name\s*=\s*["']?rating)/i.test(html) ||
    /<(?:title|h1)\b[^>]*>[^<]*(?:porn|xxx|hentai|色情|成人影片|成人视频|无码|成人视频|ポルノ|アダルト|порно|sex\s*(?:videos?|cams?)|adult\s*(?:videos?|entertainment))/i.test(html) ||
    /(?:you must be (?:at least )?18|sexually explicit (?:content|material)|confirm (?:that )?you are (?:over )?18)/i.test(html);
}

export function unusablePage(html) {
  return /<(?:title|h1)\b[^>]*>[^<]*(?:\b(?:403|404|502|503)\b|access denied|forbidden|not found|just a moment|attention required|domain (?:is )?for sale|buy this domain|website coming soon)/i.test(html) ||
    /(?:window|top|self|document)\.location(?:\.href)?\s*=\s*["']https?:/i.test(html);
}

export async function inspectUrl(value, {requireEmbed = true, useCache = true, budget} = {}) {
  let url = publicUrl(value);
  if (!url) return null;
  const key = `${requireEmbed}:${url.href}`;
  if (useCache) {
    const cached = remembered(pageCache, key);
    if (cached !== undefined) return cached;
  }
  try {
    const domains = await getBlocklist();
    const seen = new Set();
    for (let hop = 0; hop < 4; hop++) {
      if (seen.has(url.href) || blockedHost(url.hostname, domains) || !(await familyDns(url.hostname, budget))) return null;
      seen.add(url.href);
      const {response, text} = await boundedFetch(url.href, {
        redirect: 'manual', headers: {accept: 'text/html,application/xhtml+xml', 'user-agent': 'NeverLanding/2.0 (+https://neverlanding.page)'}
      }, {budget});
      if ([301,302,303,307,308].includes(response.status)) {
        url = publicUrl(new URL(response.headers.get('location') || '', url).href);
        if (!url) return null;
        continue;
      }
      if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('content-type') || '')) return null;
      if (unusablePage(text) || adultPage(text) || /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(text)) return null;
      if (requireEmbed && !allowsEmbedding(response.headers)) return null;
      const result = {url: url.href, embeddable: allowsEmbedding(response.headers)};
      remember(pageCache, key, result, 5 * 60 * 1000);
      return result;
    }
  } catch { /* Filtering/network failures never admit a candidate. */ }
  remember(pageCache, key, null, 60000);
  return null;
}
