import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin = process.env.SITE_URL || 'http://127.0.0.1:8787';
const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let serial = 0;
let visits = 0;
let unlockExplorer = false;
let failNext = false;
let duplicate = false;
const requests = new Map();
await page.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname.endsWith('.queue.test')) {
    const count = (requests.get(url.hostname) || 0) + 1;
    requests.set(url.hostname, count);
    return route.fulfill({contentType:'text/html', body:`<!doctype html><title>Prepared ${url.hostname}</title><body style="background:#eef7ff;font:24px sans-serif"><h1>${url.hostname}</h1><p>This document loaded once.</p><script>window.loadMarker=Math.random()</script>`});
  }
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/api/random') {
    if (failNext) {failNext = false; return route.fulfill({status:503,json:{error:'Temporary outage'}});}
    const next = duplicate ? serial : ++serial;
    return route.fulfill({json:{url:`https://page${next}.queue.test/`,source:'Browser fixture',visitToken:`fixture_${next}`}});
  }
  if (url.pathname === '/api/resolve') return route.fulfill({json:{url: request.postDataJSON().url}});
  if (url.pathname === '/api/auth/me') return route.fulfill({json:{user:{id:'browser-test',username:'Explorer'}}});
  if (url.pathname === '/api/auth/providers') return route.fulfill({json:{providers:{email:true}}});
  if (url.pathname === '/api/favorites') return route.fulfill({json:{items:[]}});
  if (url.pathname === '/api/progress') return route.fulfill({json:{visits}});
  if (url.pathname === '/api/visits') {const body=request.postDataJSON();assert.equal(body.visitToken,`fixture_${new URL(body.url).hostname.match(/^page(\d+)/)[1]}`);visits++; return route.fulfill({status:201,json:{ok:true}});}
  if (url.pathname === '/api/achievements/unlocked') return route.fulfill({json:{codes:['login_first','tld_biz', ...(unlockExplorer ? ['explorer_level_3'] : [])],items:[{code:'tld_biz',url:'https://first.example.biz/'},{code:'explorer_level_3',url:'https://milestone.example.org/'}]}});
  if (url.pathname === '/api/achievements/share') return route.fulfill({json:{ok:true}});
  return route.continue();
});
try {
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#queue-status')?.textContent.startsWith('5/5'));
  assert.equal(visits, 0, 'background preparation must not record visits');
  assert.equal(await page.locator('iframe.preloaded-frame').count(), 5);
  const prepared = await page.locator('iframe.preloaded-frame').first().getAttribute('src');
  const preFrame = page.frames().find(f => f.url() === prepared);
  const marker = await preFrame.evaluate(() => window.loadMarker);
  const started = Date.now();
  await page.locator('#get').click();
  await page.waitForFunction(() => document.querySelector('#url')?.textContent.includes('.queue.test'));
  const elapsed = Date.now() - started;
  const active = page.frames().find(f => f.url() === prepared);
  assert.equal(await active.evaluate(() => window.loadMarker), marker, 'promotion must preserve browsing context');
  assert.equal(requests.get(new URL(prepared).hostname), 1, 'promotion must not reload the page');
  assert.equal(await page.locator('#viewer').getAttribute('src'), prepared);
  assert.ok(elapsed < 1000, `prepared activation took ${elapsed}ms`);
  await page.waitForFunction(() => document.querySelector('#queue-status')?.textContent.startsWith('5/5'));
  assert.equal(await page.locator('.viewer iframe').count(), 6, 'five queued pages plus active page');
  for (let i=0; i<7; i++) await page.locator('#get').click();
  await page.waitForFunction(() => document.querySelector('#queue-status')?.textContent.startsWith('5/5'));
  assert.equal(visits, 8);
  assert.equal(await page.locator('.viewer iframe').count(), 6);
  assert.ok([...requests.values()].every(count => count === 1));
  await page.locator('#back').click();
  await page.locator('#forward').click();
  assert.equal(visits, 8, 'history navigation must not farm landings');
  failNext = true;
  await page.locator('#get').click();
  await page.waitForFunction(() => document.querySelector('#queue-status')?.textContent.startsWith('5/5'));
  assert.equal(await page.locator('.viewer iframe').count(), 6, 'retry must recover without leaking frames');
  // Exercise the full catalog and keyboard-accessible details.
  await page.evaluate(() => document.getElementById('achievements-modal').classList.remove('is-hidden'));
  const expected = JSON.parse(fs.readFileSync('public/data/achievements.json')).achievements;
  assert.equal(await page.locator('.achievement-tile').count(), expected.length);
  await page.getByRole('button',{name:'Clippy Would Be Proud',exact:true}).click();
  assert.ok((await page.locator('#achievement-detail-text').textContent()).includes('.help'));
  await page.getByRole('button',{name:'Close achievement dialog',exact:true}).click();
  await page.getByRole('button',{name:'Business Browsing',exact:true}).click();
  assert.equal(await page.locator('.achievement-source').getAttribute('href'),'https://first.example.biz/');
  assert.equal(await page.locator('.achievement-source').getAttribute('rel'),'noopener noreferrer');
  await page.getByRole('button',{name:'Close achievement dialog',exact:true}).click();
  await page.getByRole('button',{name:'Explorer Level 3',exact:true}).click();
  assert.equal(await page.locator('#achievement-detail-text').textContent(),'???');
  await page.getByRole('button',{name:'Close achievement dialog',exact:true}).click();
  unlockExplorer = true;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('achievements-changed')));
  await page.waitForFunction(() => document.querySelector('.achievement-tile[title="Explorer Level 3"]').classList.contains('is-unlocked'));
  await page.getByRole('button',{name:'Explorer Level 3',exact:true}).click();
  assert.ok((await page.locator('#achievement-detail-text').textContent()).startsWith('Visited the 2026th Website'));
  assert.equal(await page.locator('.achievement-source').getAttribute('href'),'https://milestone.example.org/');
  await page.getByRole('button',{name:'Close achievement dialog',exact:true}).click();
  await page.screenshot({path:'/tmp/neverlanding-achievements.png'});
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed:true,achievements:expected.length,queued:5,activationMs:elapsed,visits,errors}));
} catch (error) {
  await page.screenshot({path:"/tmp/neverlanding-browser-failure.png"});
  console.error(JSON.stringify({errors, status: await page.locator("#queue-status").textContent(), frames: page.frames().map(f => f.url()), requests:[...requests]}));
  throw error;
} finally {await browser.close();}
