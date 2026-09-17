import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.SITE_URL || 'http://127.0.0.1:8787';
const browser = await chromium.launch({headless:true});
const errors = [];
async function visitor(user = null, width = 1280) {
  const context = await browser.newContext({viewport:{width,height:800}});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  let serial = 0;
  let saved = false;
  let authRequests = 0;
  let releaseAuth;
  const authGate = new Promise(resolve => { releaseAuth = resolve; });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname.endsWith('.queue.test')) return route.fulfill({contentType:'text/html',body:'<h1>Your next discovery</h1>'});
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/random') return route.fulfill({json:{url:`https://page${++serial}.queue.test/`}});
    if (url.pathname === '/api/auth/me') {
      authRequests++;
      await authGate;
      return route.fulfill({json:{user}});
    }
    if (url.pathname === '/api/favorites') {
      if (route.request().method() === 'POST') saved = !saved;
      return route.fulfill({json:{items:saved ? [{url:await page.locator('#url').textContent()}] : []}});
    }
    if (url.pathname === '/api/auth/logout') {user = null; return route.fulfill({json:{ok:true}});}
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:{items:[],codes:[],providers:{email:true}}});
    return route.continue();
  });
  await page.goto(origin, {waitUntil:"domcontentloaded"});
  await expect(page.locator('#onboarding-hint')).toBeHidden();
  releaseAuth();
  return {page,context,getAuthRequests:()=>authRequests};
}
try {
  const {page,context,getAuthRequests} = await visitor();
  await expect(page.locator('#onboarding-hint')).toBeVisible();
  await expect(page.locator('#onboarding-clippy')).toBeVisible();
  await expect(page.locator('#onboarding-text')).toContainText('Press Go');
  assert.deepEqual(await page.locator('.toolbar > button').evaluateAll(nodes=>nodes.map(n=>n.id)),['back','forward','stop','refresh','get','favorite-toggle']);
  const address = await page.locator('.address-bar').boundingBox();
  const toolbar = await page.locator('.toolbar').boundingBox();
  assert.ok(address.y+address.height <= toolbar.y);
  for (const width of [320,375,480,720,1280]) {
    await page.setViewportSize({width,height:800});
    const boxes = await page.locator('.toolbar > button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {y:r.y,right:r.right,left:r.left};}));
    assert.ok(boxes.every(b=>b.y === boxes[0].y && b.left>=0 && b.right<=width),`one row at ${width}px`);
  }
  await page.screenshot({path:'/tmp/neverlanding-toolbar-desktop.png'});
  await page.setViewportSize({width:375,height:812});
  await page.screenshot({path:'/tmp/neverlanding-toolbar-mobile.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#get').evaluate(n=>getComputedStyle(n).animationName),'none');
  await page.locator('#get').click();
  await expect(page.locator('#onboarding-text')).toContainText('star');
  await page.locator('#favorite-toggle').click();
  await expect(page.locator('#onboarding-hint')).toBeHidden();
  await expect(page.locator('#login-modal')).toBeVisible();
  await Promise.all([page.waitForResponse(r => r.url().endsWith("/api/auth/me")), page.reload()]);
  await expect.poll(getAuthRequests).toBe(2);
  await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.startsWith('5/5'));
  await expect(page.locator('#onboarding-hint')).toBeHidden();
  await expect(page.locator('#onboarding-clippy')).toBeHidden();
  await context.close();

  const registered = await visitor({id:'registered',username:'Explorer'});
  await expect(registered.page.locator('#login-menu')).toContainText('Logged in as');
  await expect(registered.page.locator('#onboarding-hint')).toBeHidden();
  await expect(registered.page.locator('#onboarding-clippy')).toBeHidden();
  await registered.page.locator('#get').click();
  await registered.page.locator('#favorite-toggle').click();
  await expect(registered.page.locator('#favorite-toggle')).toHaveAttribute('aria-pressed','true');
  await expect(registered.page.locator('#favorite-toggle')).toHaveAttribute('aria-label','Remove from favorites');
  await registered.page.locator('#favorite-toggle').click();
  await expect(registered.page.locator('#favorite-toggle')).toHaveAttribute('aria-pressed','false');
  await registered.page.evaluate(()=>document.getElementById('logout-menu').click());
  await expect(registered.page.locator('#login-menu')).toHaveText('Login');
  await expect(registered.page.locator('#onboarding-hint')).toBeHidden();
  await registered.context.close();

  const dismissed = await visitor();
  await expect(dismissed.page.locator('#onboarding-hint')).toBeVisible();
  await dismissed.page.locator('#onboarding-dismiss').click();
  await dismissed.page.locator('#get').click();
  await expect(dismissed.page.locator('#onboarding-hint')).toBeHidden();
  await dismissed.context.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['guest hints once','no auth flash','registered and logged-out visitors excluded','dismissal','favorites save/remove','single row 320–1280px','reduced motion'],errors}));
} finally { await browser.close(); }
