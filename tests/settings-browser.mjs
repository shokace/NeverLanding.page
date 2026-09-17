import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const origin = process.env.SITE_URL || 'http://127.0.0.1:8787';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let user = {id:'settings-fixture',username:'Explorer',email:'private@example.invalid'};
let hasPassword = true, oldGoogleSession = false, serial = 0, deletes = 0, revokes = 0;
await page.addInitScript(() => {
  localStorage.setItem('neverlanding-introduction-seen','1');
  localStorage.setItem('neverlanding-achievements-seen:settings-fixture','["login_first"]');
});
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname.endsWith('.queue.test')) return route.fulfill({contentType:'text/html',body:'<h1>Another discovery</h1>'});
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/api/auth/me') return route.fulfill({json:{user}});
  if (url.pathname === '/api/random') return route.fulfill({json:{url:`https://page${++serial}.queue.test/`,visitToken:'fixture-receipt'}});
  if (url.pathname === '/api/account') return route.fulfill({json:{hasPassword}});
  if (url.pathname === '/api/account/profile') {
    const {username} = route.request().postDataJSON();
    if (username.toLowerCase() === 'taken') return route.fulfill({status:409,json:{error:'That username is already taken. Choose another.'}});
    user = {...user,username};
    return route.fulfill({json:{username}});
  }
  if (url.pathname === '/api/account/sessions/revoke') {revokes++;return route.fulfill({json:{ok:true}});}
  if (url.pathname === '/api/account/delete') {
    deletes++;
    const body = route.request().postDataJSON();
    assert.equal(body.confirmation,'DELETE');
    if (hasPassword && body.password !== 'correct-password') return route.fulfill({status:403,json:{error:'That password is incorrect.'}});
    if (!hasPassword && oldGoogleSession) return route.fulfill({status:403,json:{code:'REAUTH_REQUIRED',error:'Sign in again, then return to Settings to delete your account.'}});
    user = null;
    return route.fulfill({json:{ok:true}});
  }
  if (url.pathname === '/api/auth/logout') {user=null;return route.fulfill({json:{ok:true}});}
  if (url.pathname === '/api/achievements/unlocked') return route.fulfill({json:{codes:user ? ['login_first','tld_biz'] : [],items:[]}});
  if (url.pathname === '/api/favorites') return route.fulfill({json:{items:user ? [{url:'https://saved.example/',title:'Saved favorite'}] : []}});
  if (url.pathname.startsWith('/api/')) return route.fulfill({json:{providers:{email:true,google:true},items:[],visits:7}});
  return route.continue();
});
async function open() {
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('#settings-modal')).toBeVisible();
}
try {
  await page.goto(origin);
  await expect(page.locator('#login-menu')).toContainText('Explorer');
  await page.locator('#get').click();
  await expect(page.locator('#url')).toContainText('.queue.test');
  await open();
  await expect(page.getByRole('button',{name:'Close settings',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#settings-delete-details summary')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Close settings',exact:true})).toBeFocused();
  const username = page.locator('#settings-username-form input');
  await username.fill('mail@example.com');
  assert.equal(await username.evaluate(el=>el.checkValidity()),false);
  await username.fill('Taken');
  await page.locator('#settings-username-form button').click();
  await expect(page.locator('#settings-status')).toContainText('already taken');
  await username.fill('New_Explorer');
  await page.locator('#settings-username-form button').click();
  await expect(page.locator('#settings-status')).toContainText('Username saved');
  await expect(page.locator('#login-menu')).toContainText('New_Explorer');
  await expect(page.locator('#landing-counter')).toHaveText('Landings: 7');
  await page.locator('#settings-revoke-sessions').click();
  await expect(page.locator('#settings-status')).toContainText('Other devices signed out');
  assert.equal(revokes,1);
  await page.locator('#settings-motion').selectOption('reduce');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion','true');
  assert.equal(await page.evaluate(()=>localStorage.getItem('neverlanding-motion')),'reduce');
  await page.locator('#settings-clear-history').click();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('neverlanding-history')),null);
  await expect(page.locator('#back')).toBeDisabled();
  await expect(page.locator('#forward')).toBeDisabled();
  await expect(page.locator('#landing-counter')).toHaveText('Landings: 7');
  await page.screenshot({path:'/tmp/neverlanding-settings.png'});
  await page.setViewportSize({width:375,height:812});
  await page.locator('#settings-delete-details summary').click();
  await page.locator('#settings-delete-form [name=confirmation]').fill('DELETE');
  await page.locator('#settings-delete-form [name=password]').fill('wrong-password');
  await page.locator('#settings-delete-submit').click();
  await expect(page.locator('#settings-status')).toContainText('incorrect');
  await expect(page.locator('#settings-modal')).toBeVisible();
  await page.screenshot({path:'/tmp/neverlanding-settings-mobile.png'});
  const bounds = await page.locator('.settings-window').boundingBox();
  assert.ok(bounds.x>=0 && bounds.x+bounds.width<=375 && bounds.y>=0 && bounds.y+bounds.height<=812);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-modal')).toBeHidden();
  await expect(page.getByRole('button',{name:'File',exact:true})).toBeFocused();
  await open();
  await page.locator('#settings-delete-details summary').click();
  await expect(page.locator('#settings-delete-form [name=password]')).toHaveValue('');
  await expect(page.locator('#settings-delete-form [name=confirmation]')).toHaveValue('');
  await page.locator('#settings-delete-form [name=confirmation]').fill('no');
  await page.locator('#settings-delete-form [name=password]').fill('correct-password');
  await page.locator('#settings-delete-submit').click();
  assert.equal(deletes,1,'browser confirmation prevents accidental deletion');
  await page.locator('#settings-delete-form [name=confirmation]').fill('DELETE');
  await page.locator('#settings-delete-submit').click();
  await expect(page.locator('#settings-modal')).toBeHidden();
  await expect(page.locator('#meta')).toContainText('Account deleted');
  await expect(page.locator('#login-menu')).toHaveText('Login');
  await expect(page.locator('#landing-counter')).toHaveText('Landings: 0');
  assert.equal(await page.evaluate(()=>localStorage.getItem('neverlanding-achievements-seen:settings-fixture')),null);
  await expect(page.locator('.achievement-tile.is-unlocked')).toHaveCount(0);
  await open();
  await expect(page.locator('#settings-guest')).toBeVisible();
  await expect(page.locator('#settings-account')).toBeHidden();
  await expect(page.locator('#settings-danger')).toBeHidden();
  await page.locator('#settings-login').click();
  await expect(page.locator('#login-modal')).toBeVisible();
  // Google-only accounts get a fresh-sign-in path, never a password prompt.
  user = {id:'google-fixture',username:'Google_Explorer'};
  hasPassword = false;
  oldGoogleSession = true;
  await page.reload();
  await expect(page.locator('#login-menu')).toContainText('Google_Explorer');
  await open();
  await page.locator('#settings-delete-details summary').click();
  await expect(page.locator('#settings-password-field')).toBeHidden();
  await page.locator('#settings-delete-form [name=confirmation]').fill('DELETE');
  await page.locator('#settings-delete-submit').click();
  await expect(page.locator('#settings-reauth')).toBeVisible();
  await page.locator('#settings-reauth').click();
  await expect(page.locator('#settings-modal')).toBeHidden();
  await expect(page.locator('#login-modal')).toBeVisible();
  await expect(page.locator('#login-menu')).toHaveText('Login');
  assert.deepEqual(errors,[]);
  console.log('Settings browser passed: rename/collision, preferences, history, session controls, deliberate deletion, cleanup, Google reauthentication, mobile layout, and keyboard focus.');
} finally {await browser.close();}
