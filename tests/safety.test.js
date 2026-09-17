import test from 'node:test';
import assert from 'node:assert/strict';
import {publicUrl, blockedHost, allowsEmbedding, adultPage, isPublicIPv4, inspectUrl} from '../lib/safety.js';

test('public URL and IP validation reject private-network destinations', () => {
  for (const url of ['file:///etc/passwd', 'http://example.com', 'https://127.1', 'https://[::1]', 'https://example.local', 'https://example.com:8080', 'https://user@example.com']) assert.equal(publicUrl(url), null, url);
  for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.1.2', '172.16.0.1', '192.168.0.1', '100.64.0.1', '224.1.2.3', 'bad']) assert.equal(isPublicIPv4(ip), false, ip);
  assert.equal(isPublicIPv4('1.1.1.1'), true);
});

test('adult host matching covers subdomains and sensitive TLDs without substring collisions', () => {
  const domains = new Set(['blocked.example']);
  assert.ok(blockedHost('cdn.blocked.example', domains));
  assert.ok(blockedHost('anything.xxx', domains));
  assert.ok(!blockedHost('notblocked.example', domains));
  assert.ok(!blockedHost('sussex.ac.uk', domains));
});

test('frame policy parses each directive and policy, not unrelated wildcards', () => {
  const csp = value => new Headers({'content-security-policy': value});
  assert.equal(allowsEmbedding(new Headers()), true);
  assert.equal(allowsEmbedding(new Headers({'x-frame-options':'SAMEORIGIN'})), false);
  assert.equal(allowsEmbedding(csp("default-src *; frame-ancestors 'self'")), false);
  assert.equal(allowsEmbedding(csp("frame-ancestors *; script-src 'self'")), true);
  assert.equal(allowsEmbedding(csp("frame-ancestors * https://host.com, frame-ancestors 'none'")), false);
  assert.equal(allowsEmbedding(csp('frame-ancestors https://*.host.com')), false);
});

test('adult-page metadata and age gates are rejected', () => {
  for (const html of ['<meta name="rating" content="adult">', '<meta content="RTA-5042" name="rating">', '<title>Free porn videos</title>', 'You must be at least 18']) assert.ok(adultPage(html), html);
  assert.equal(adultPage('<title>Astronomy for everyone</title>'), false);
});

test('live checks fail closed and validate redirects before fetching their destinations', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let mode = 'safe';
  globalThis.fetch = async value => {
    const url = String(value); requests.push(url);
    if (url.includes('nsfw-onlydomains.txt')) return new Response(Array.from({length: 1100}, (_,i) => `blocked${i}.example`).join('\n'));
    if (url.includes('dns-query')) {
      if (mode === 'dns-error') throw new Error('offline');
      return Response.json({Status: 0, Answer: [{type: 1, data: mode === 'dns-block' ? '0.0.0.0' : '1.1.1.1'}]});
    }
    if (mode === 'redirect') return new Response(null, {status:302,headers:{location:'https://blocked1.example/'}});
    if (mode === 'private') return new Response(null, {status:302,headers:{location:'https://127.0.0.1/'}});
    if (mode === 'non-html') return new Response('file', {headers:{'content-type':'application/zip'}});
    return new Response(mode === 'adult' ? '<meta name="rating" content="adult">' : '<title>Learning</title>', {headers:{'content-type':'text/html'}});
  };
  try {
    assert.ok(await inspectUrl('https://safe.example.com/'));
    for (const next of ['dns-error','dns-block','redirect','private','non-html','adult']) {
      mode = next;
      assert.equal(await inspectUrl(`https://${mode}.example.com/`, {useCache:false}), null, mode);
    }
    assert.ok(!requests.includes('https://blocked1.example/'));
    assert.ok(!requests.includes('https://127.0.0.1/'));
  } finally {globalThis.fetch = originalFetch;}
});

test('a missing adult blocklist never admits an unchecked website', async () => {
  const {inspectUrl:freshInspect} = await import('../lib/safety.js?offline-blocklist');
  const original = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('Filter unavailable');};
  try {assert.equal(await freshInspect('https://example.com/'),null);}
  finally {globalThis.fetch=original;}
});

test('soft error pages, challenge pages and parked domains do not become ready landings', async () => {
  const {unusablePage} = await import('../lib/safety.js');
  for (const title of ['404 Not Found','403 Forbidden','Just a moment...','This domain is for sale','Access denied']) assert.ok(unusablePage(`<title>${title}</title>`));
  assert.ok(!unusablePage('<title>Interesting science</title>'));
});
