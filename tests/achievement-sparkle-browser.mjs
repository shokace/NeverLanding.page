import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const origin=process.env.SITE_URL || 'http://127.0.0.1:8787';
const catalog=JSON.parse(readFileSync('public/data/achievements.json','utf8')).achievements;
const far=catalog.findLast(a=>a.available!==false && a.code.startsWith('tld_'));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
let user='sparkle-player', codes=['login_first',far.code,'tld_mf'], serial=0;
const seenKey=id=>`neverlanding-achievements-seen:${id}`;
await page.addInitScript(()=>{
  if (!localStorage.getItem('sparkle-fixture-seeded')) {
    localStorage.setItem('neverlanding-achievements-seen:sparkle-player',JSON.stringify(['login_first']));
    localStorage.setItem('sparkle-fixture-seeded','1');
  }
});
await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.hostname.endsWith('.queue.test'))return route.fulfill({contentType:'text/html',body:'<h1>Discovery</h1>'});
  if(url.origin!==origin)return route.abort();
  if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:{id:user,username:'Explorer'}}});
  if(url.pathname==='/api/achievements/unlocked')return route.fulfill({json:{codes,items:[]}});
  if(url.pathname==='/api/random')return route.fulfill({json:{url:`https://page${++serial}.queue.test/`,visitToken:'fixture'}});
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{providers:{email:true},items:[],visits:1}});
  return route.continue();
});
const tile=code=>page.locator(`.achievement-tile[data-index="${catalog.findIndex(a=>a.code===code)}"]`);
const seen=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'[]'),seenKey(user));
const open=()=>page.locator('#achievements-menu').click();
const close=()=>page.getByRole('button',{name:'Close achievements dialog',exact:true}).click();
const refresh=()=>page.evaluate(()=>document.dispatchEvent(new CustomEvent('achievements-changed')));
try {
  await page.goto(origin);
  await expect(tile(far.code)).toHaveClass(/is-new/);
  assert.ok(!(await seen()).includes(far.code),'closed panel must not consume the notification');
  assert.equal(await page.locator('.achievement-sparkle').count(),0);
  await open();
  await expect(tile(far.code).locator('.achievement-sparkle')).toHaveCount(6);
  assert.equal(await tile('login_first').locator('.achievement-sparkle').count(),0,'previously seen awards never replay');
  assert.ok(!(await seen()).includes(far.code),'keep sparkles active until the window closes');
  assert.ok(await page.locator('.achievements-body').evaluate(n=>n.scrollTop)>0,'notification reveals off-screen unlock');
  await refresh();
  await expect(tile(far.code).locator('.achievement-sparkle')).toHaveCount(6,'refresh does not duplicate particles');
  await page.screenshot({path:'/tmp/neverlanding-achievement-sparkle.png'});
  await page.waitForTimeout(2800);
  await expect(tile(far.code).locator('.achievement-sparkle')).toHaveCount(6);
  await expect(tile(far.code).locator('.achievement-sparkle').first()).toHaveCSS('animation-iteration-count','infinite');
  await expect(tile(far.code)).toHaveClass(/is-celebrating/);
  assert.notEqual(await tile(far.code).evaluate(n=>getComputedStyle(n).boxShadow),'none','earned glow remains');
  await close();
  assert.ok((await seen()).includes(far.code));
  await expect(page.locator("#achievements-menu")).not.toHaveClass(/has-badge/);
  await open();
  assert.equal(await page.locator('.achievement-sparkle').count(),0,'reopening does not replay');
  await close();
  await page.reload();
  await expect(tile(far.code)).toHaveClass(/is-unlocked/);
  await open();
  assert.equal(await page.locator('.achievement-sparkle').count(),0,'reload remembers seen awards');
  await close();

  // Two simultaneous awards: only the visible one is consumed.
  codes.push('tld_biz',catalog.at(-2).code);
  const second=catalog.at(-2).code;
  assert.notEqual(second,far.code);
  await refresh();
  await expect(tile('tld_biz')).toHaveClass(/is-new/);
  await open();
  await expect(tile('tld_biz').locator('.achievement-sparkle')).toHaveCount(6);
  assert.ok(!(await seen()).includes(second),'off-screen award must wait');
  await close(); // Closing during the animation must not restart it next time.
  assert.equal(await page.locator('.achievement-sparkle').count(),0);
  await open();
  await expect(tile(second).locator('.achievement-sparkle')).toHaveCount(6);
  assert.equal(await tile('tld_biz').locator('.achievement-sparkle').count(),0);
  await close();

  // Same browser, different account: that player's unlock can celebrate once.
  user='another-player'; codes=['login_first'];
  await page.evaluate(id=>document.dispatchEvent(new CustomEvent('auth-changed',{detail:{user:{id,username:'Another'}}})),user);
  await expect(tile('login_first')).toHaveClass(/is-new/);
  await open();
  await expect(tile('login_first').locator('.achievement-sparkle')).toHaveCount(6);
  await close();
  // Reduced motion consumes the notification without moving particles.
  await page.emulateMedia({reducedMotion:'reduce'});
  codes.push('tld_biz'); await refresh();
  await expect(tile('tld_biz')).toHaveClass(/is-new/);
  await open();
  await expect(tile('tld_biz')).toBeInViewport({ratio:0.6});
  await close();
  await expect.poll(seen).toContain('tld_biz');
  assert.equal(await page.locator('.achievement-sparkle').count(),0);
  assert.notEqual(await tile('tld_biz').evaluate(n=>getComputedStyle(n).boxShadow),'none');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,loopsUntilClosed:true,oncePerUnlock:true,persistsAcrossReload:true,revealsNewAward:true,offscreenWaits:true,accountIsolation:true,reducedMotion:true,errors}));
} finally {await browser.close();}
