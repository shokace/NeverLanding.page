import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.SITE_URL || 'http://127.0.0.1:8787';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://*.queue.test/**', route => {
  if (route.request().url().includes('slow.')) return new Promise(resolve => setTimeout(async()=>{await route.fulfill({contentType:'text/html',body:'<h1>Late</h1>'}).catch(()=>{});resolve();},300));
  return route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Ready</h1>'});
});
await page.route('**/queue-harness', route => route.fulfill({contentType:'text/html',body:'<!doctype html><div id="pool"></div>'}));
try {
  await page.goto(origin+'/queue-harness');
  const result = await page.evaluate(async () => {
    const {LandingQueue} = await import('/scripts/landing-queue.js');
    const waitFor = async predicate => {
      const deadline = Date.now()+10000;
      while(!predicate()) {if(Date.now()>deadline)throw new Error('Queue harness timeout');await new Promise(r=>setTimeout(r,10));}
    };
    let serial = 0, active = 0, maxActive = 0, mode = 'normal';
    let container = document.getElementById('pool');
    const fetcher = async (_url, {signal}) => {
      active++; maxActive = Math.max(maxActive,active);
      try {
        if (mode === 'hanging') await new Promise((resolve,reject) => signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
        const host = mode === 'duplicates' ? 'same' : mode === 'slow' ? 'slow' : 'n'+(++serial);
        return Response.json({url:`https://${host}.queue.test/`});
      } finally {active--;}
    };
    const queue = new LandingQueue({container,fetcher,pageTimeout:150,requestTimeout:100,readyTtl:400});
    queue.start();
    await waitFor(()=>queue.readyCount===5);
    if(maxActive>3)throw new Error('Too many simultaneous preparations');
    const initial = new Set(queue.entries.map(e=>e.url));
    await waitFor(()=>queue.readyCount===5 && queue.entries.every(e=>!initial.has(e.url)));
    if(container.children.length!==5)throw new Error('Expired frame leak');
    queue.close();
    if(container.children.length)throw new Error('Close leaked frames');
    mode='duplicates';
    const duplicates = new LandingQueue({container,fetcher,pageTimeout:150,requestTimeout:100});
    duplicates.start();
    await waitFor(()=>duplicates.pending===0 && duplicates.readyCount===1);
    if(container.children.length!==1)throw new Error('Duplicate frame admitted');
    duplicates.close();
    mode='hanging';
    const cancellable = new LandingQueue({container,fetcher,pageTimeout:150,requestTimeout:100});
    const controller = new AbortController();
    const pending = cancellable.take(controller.signal).then(()=>false,e=>e.name==='AbortError');
    controller.abort();
    if(!(await pending))throw new Error('Cancellation failed');
    await waitFor(()=>cancellable.pending===0);
    mode='normal';
    clearTimeout(cancellable.retryTimer);cancellable.retryTimer=null;cancellable.start();
    await waitFor(()=>cancellable.readyCount===5);
    cancellable.close();
    mode='slow';
    const slow = new LandingQueue({container,fetcher,target:1,pageTimeout:50,requestTimeout:100});
    slow.start();
    await waitFor(()=>slow.pending===0);
    if(slow.readyCount || container.children.length)throw new Error('Timed-out frame admitted');
    slow.close();
    return {maxConcurrent:maxActive,expiry:true,duplicates:true,cancel:true,requestTimeout:true,pageTimeout:true,cleanup:true};
  });
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(result));
} finally {await browser.close();}
