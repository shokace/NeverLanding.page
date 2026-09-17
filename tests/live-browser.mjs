import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const site = process.env.SITE_URL || 'http://127.0.0.1:8787';
const api = process.env.API_URL || 'https://neverlanding.page';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];
page.on('pageerror',error=>{if(error.stack?.includes('/scripts/app.js') || error.stack?.includes('/scripts/landing-queue.js')) errors.push(error.message);});
if (site !== api) await page.route('**/api/random?*',async route=>{
 try {const response=await page.request.get(api+new URL(route.request().url()).pathname+new URL(route.request().url()).search,{timeout:35000});await route.fulfill({response});}
 catch {await route.fulfill({status:503,json:{error:'Network timeout'}}).catch(()=>{});}
});
try {
 const started=Date.now();
 await page.goto(site,{waitUntil:'domcontentloaded'});
 for(let i=0;i<12;i++) {
   try {await page.waitForFunction(()=>document.querySelector('#queue-status')?.textContent.startsWith('5/5'),null,{timeout:10000});break;}
   catch {console.log(JSON.stringify({elapsed:Date.now()-started,queue:await page.locator('#queue-status').textContent()}));}
 }
 const status=await page.locator('#queue-status').textContent();
 assert.ok(status.startsWith('5/5'),status);
 const queued = await page.locator('iframe.preloaded-frame').evaluateAll(frames=>frames.map(frame=>frame.src));
 const first=Date.now();await page.locator('#get').click();
 await page.waitForFunction(()=>document.querySelector('#url').textContent.startsWith('https://'));
 const activation=Date.now()-first;
 const activeSrc=await page.locator('#viewer').getAttribute('src');
 // Client-side routers can add a fragment or path without reloading the iframe.
 // Follow the displayed element's browsing context instead of an exact URL match.
 const frame=await (await page.locator('#viewer').elementHandle()).contentFrame();
 const frames=page.frames().filter(frame=>frame.parentFrame()===page.mainFrame() && queued.includes(frame.url())).map(frame=>({url:frame.url()}));
 const bodyText = frame ? (await frame.locator('body').innerText({timeout:5000}).catch(()=>'')) : '';
 await page.screenshot({path:'/tmp/neverlanding-live.png'});
 console.log(JSON.stringify({status,fillMs:Date.now()-started,activationMs:activation,queued,activeSrc,actualUrl:frame?.url(),bodyPreview:bodyText.slice(0,250),frames,errors}));
 assert.ok(frame,'Displayed frame must have a browsing context');
 assert.equal(new URL(frame.url()).origin,new URL(activeSrc).origin,'Displayed frame must contain the expected live destination');
 assert.ok(bodyText.trim().length>10,'Displayed page must contain content');
 assert.deepEqual(errors,[]);
} finally {await browser.close();}
