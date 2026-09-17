import {publicUrl} from './url.js';
const encoder = new TextEncoder();
const TTL_SECONDS = 10 * 60;
let cachedKey;
async function signingKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Visit signing is unavailable');
  if (cachedKey?.secret !== secret) cachedKey = {secret, key: await crypto.subtle.importKey(
    'raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify'])};
  return cachedKey.key;
}
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
}
export async function issueVisitReceipt(secret, url, userId = null, now = Date.now()) {
  const parsed = publicUrl(url);
  if (!parsed) throw new Error('Invalid destination');
  const issued = Math.floor(now / 1000);
  const payload = encode(encoder.encode(JSON.stringify({v:1,id:crypto.randomUUID(),url:parsed.href,sub:userId,iat:issued,exp:issued+TTL_SECONDS})));
  const signature = await crypto.subtle.sign('HMAC',await signingKey(secret),encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyVisitReceipt(secret, token, url, userId, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 8192 || !userId) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !(await crypto.subtle.verify('HMAC',await signingKey(secret),decode(parts[1]),encoder.encode(parts[0])))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const time = Math.floor(now / 1000);
    if (data.v !== 1 || !/^[0-9a-f-]{36}$/.test(data.id) || data.url !== publicUrl(url)?.href ||
      (data.sub !== null && data.sub !== userId) || !Number.isInteger(data.iat) || !Number.isInteger(data.exp) ||
      data.iat > time + 5 || data.exp <= time || data.exp - data.iat !== TTL_SECONDS) return null;
    return {id:data.id};
  } catch {return null;}
}
