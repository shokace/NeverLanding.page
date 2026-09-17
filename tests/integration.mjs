import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const origin = 'http://127.0.0.1:8787';
let cookie = '';
async function request(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(origin + path, {method,headers:{'content-type':'application/json',cookie},body:body && JSON.stringify(body)});
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return {status:response.status,body:await response.json()};
}
const name = `test_${randomUUID().slice(0,8)}`;
assert.equal((await request('/api/visits',{url:'https://example.com/'})).status,401);
assert.equal((await request('/api/auth/register',{username:name,email:`${name}@example.invalid`,password:randomUUID()})).status,201);
assert.ok((await request('/api/achievements/unlocked')).body.codes.includes('login_first'));
for (const url of ['https://example.biz/','https://example.co.uk/','https://example.dev/']) assert.equal((await request('/api/visits',{url})).status,201);
const result = (await request('/api/achievements/unlocked')).body;
const awards = result.codes;
assert.equal(result.items.find(a => a.code === 'tld_biz').url,'https://example.biz/');
for (const code of ['login_first','tld_biz','tld_uk','tld_dev']) assert.ok(awards.includes(code),code);
assert.ok(!awards.includes('tld_co'));
assert.equal((await request('/api/achievements/share',{url:'https://example.dev/'})).status,200);
assert.equal((await request('/api/achievements/unlocked')).body.items.find(a => a.code === 'share_first').url,'https://example.dev/');
assert.equal((await request('/api/visits',{url:'javascript:alert(1)'})).status,400);
assert.equal((await request('/api/progress')).body.visits,3);
assert.equal((await fetch(origin+'/api/random',{method:'OPTIONS'})).status,204);
await request('/api/auth/logout',{});
assert.equal((await request('/api/achievements/unlocked')).status,401);
console.log('Local D1 integration passed: registration, login award, exact TLDs, sharing, invalid visits, progress, logout, preflight.');
