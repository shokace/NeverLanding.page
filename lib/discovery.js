import catalog from '../public/data/sites.json' with {type: 'json'};
import registries from '../public/data/registry-sites.json' with {type: 'json'};
import {inspectUrl, publicUrl, boundedFetch} from './safety.js';

export const supplementalSites = [...new Set([...Object.values(catalog.groups).flat(), ...registries.sites.map(site => site.host)])];
let metadata;
let listTask;
let cachedList;
const DAY = 86400000;

export function parseDomains(csv) {
  return csv.split(/\r?\n/).map(line => line.trim().split(',')[1])
    .filter(domain => domain && /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+$/i.test(domain));
}

async function fromR2(env) {
  const key = env.TRANCO_R2_KEY || 'tranco/top-1m.csv';
  if (!metadata || metadata.key !== key || Date.now() - metadata.at > 3600000) {
    const head = await env.TRANCO_BUCKET.head(key);
    if (!head?.size) return [];
    metadata = {key, size: head.size, at: Date.now(), etag: head.etag};
  }
  // Random byte ranges cover the whole list, not just its popular first rows.
  const offset = Math.floor(Math.random() * Math.max(1, metadata.size - 8192));
  const object = await env.TRANCO_BUCKET.get(key, {range: {offset, length: 8192}});
  if (!object) return [];
  let csv = await object.text();
  if (offset) csv = csv.slice(csv.indexOf('\n') + 1);
  if (offset + 8192 < metadata.size) csv = csv.slice(0, csv.lastIndexOf('\n'));
  return parseDomains(csv);
}

async function streamList(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let reader;
  try {
    const response = await fetch(url, {signal: controller.signal, cf: {cacheTtl: 86400}});
    if (!response.ok || !response.body) throw new Error('List unavailable');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = '', size = 0;
    const domains = [];
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 40000000) throw new Error('List too large');
      const text = carry + decoder.decode(value, {stream: true});
      const end = text.lastIndexOf('\n');
      if (end < 0) {carry = text; continue;}
      for (const domain of parseDomains(text.slice(0, end))) domains.push(domain);
      carry = text.slice(end + 1);
    }
    domains.push(...parseDomains(carry + decoder.decode()));
    return domains;
  } finally {clearTimeout(timer); await reader?.cancel().catch(() => {});}
}

async function fullList(env) {
  const cacheKey = env.TRANCO_URL || 'latest';
  if (cachedList?.key === cacheKey && Date.now() - cachedList.at < DAY) return cachedList.domains;
  if (!listTask) listTask = (async () => {
    let url = env.TRANCO_URL;
    if (!url) {
      const {response, text} = await boundedFetch('https://tranco-list.eu/api/lists/date/latest', {cf: {cacheTtl: 3600}});
      if (!response.ok) throw new Error('List metadata unavailable');
      url = JSON.parse(text).download;
    }
    if (!publicUrl(url)) throw new Error('Invalid list URL');
    const domains = await streamList(url);
    if (domains.length < 1000) throw new Error('List incomplete');
    cachedList = {key: cacheKey, domains, at: Date.now()};
    return domains;
  })().finally(() => {listTask = null;});
  return listTask;
}

export async function candidates(env, count = 12) {
  let domains = [];
  try { if (env.TRANCO_BUCKET) domains = await fromR2(env); } catch {}
  if (!domains.length) {
    try { domains = await fullList(env); } catch {}
  }
  const picks = new Map();
  for (let attempt = 0; picks.size < count && attempt < count * 10; attempt++) {
    const supplement = !domains.length || Math.random() < 0.2;
    const pool = supplement ? supplementalSites : domains;
    const domain = pool[Math.floor(Math.random() * pool.length)];
    picks.set(domain, {url: `https://${domain}/`, source: supplement ? 'Discovery collection' : 'Tranco — random across the full list'});
  }
  return [...picks.values()];
}

export async function randomLanding(env, excluded = [], ctx) {
  const exclusions = new Set(excluded.map(value => publicUrl(value)?.hostname).filter(Boolean));
  const budget = {remaining: 40};
  const pool = (await candidates(env)).filter(entry => !exclusions.has(new URL(entry.url).hostname));
  // Parallel probes reduce cold-start delay; batches bound subrequests and load.
  for (let i = 0; i < pool.length; i += 3) {
    const tasks = pool.slice(i, i + 3).map(async entry => {
      const checked = await inspectUrl(entry.url, {budget});
      if (!checked || exclusions.has(new URL(checked.url).hostname)) throw new Error('Unsuitable destination');
      return {...entry, ...checked, at: new Date().toISOString()};
    });
    const settled = Promise.allSettled(tasks);
    if (ctx) ctx.waitUntil(settled);
    try { return await Promise.any(tasks); } catch { await settled; }
  }
  return null;
}
