import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {issueVisitReceipt} from '../lib/visit-receipts.js';
globalThis.crypto ||= webcrypto;
const origin = 'http://127.0.0.1:8787'; // Deliberately local-only: never create production fixtures.
const secret = readFileSync('.dev.vars','utf8').match(/^VISIT_SIGNING_KEY=(.+)$/m)?.[1].trim();
assert.ok(secret,'Configure the local VISIT_SIGNING_KEY before integration tests.');
let cookie = '';
async function request(path, body, method = body ? 'POST' : 'GET', headers = {}) {
  const response = await fetch(origin + path, {method,headers:{'content-type':'application/json',connection:'close',cookie,...headers},body:body && JSON.stringify(body)});
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return {status:response.status,body:await response.json(),headers:response.headers};
}
function sql(command) {
  execFileSync('npx',['wrangler','d1','execute','neverlanding-dev','--local','--command',command,'--json'],{stdio:['ignore','pipe','pipe']});
}
async function register(name) {
  const result = await request('/api/auth/register',{username:name,email:`${name}@example.invalid`,password:randomUUID()});
  assert.equal(result.status,201,JSON.stringify(result.body));
  return {user:result.body.user,cookie};
}
const name = `test_${randomUUID().slice(0,8)}`;
assert.equal((await request('/api/visits',{url:'https://example.com/'})).status,401);
assert.equal((await request('/api/auth/register',{email:'none@example.invalid',password:randomUUID()})).status,400);
assert.equal((await request('/api/auth/register',{username:'private@example.com',email:'none@example.invalid',password:randomUUID()})).status,400);
const alice = await register(name);
assert.equal((await request('/api/auth/register',{username:name.toUpperCase(),email:`other_${name}@example.invalid`,password:randomUUID()})).status,409);
assert.ok((await request('/api/achievements/unlocked')).body.codes.includes('login_first'));
let receipt;
for (const url of ['https://example.biz/','https://example.co.uk/','https://example.dev/']) {
  receipt = await issueVisitReceipt(secret,url,alice.user.id);
  assert.equal((await request('/api/visits',{url,visitToken:receipt})).status,201);
}
assert.equal((await request('/api/visits',{url:'https://example.dev/',visitToken:receipt})).status,409,'receipt replay');
assert.equal((await request('/api/visits',{url:'https://example.com/'})).status,403,'forged visit');
assert.equal((await request('/api/visits',{url:'https://example.net/',visitToken:receipt})).status,403,'changed destination');
assert.equal((await request('/api/visits',{url:'javascript:alert(1)'})).status,400);
const result = (await request('/api/achievements/unlocked')).body;
assert.equal(result.items.find(a => a.code === 'tld_biz').url,'https://example.biz/');
for (const code of ['login_first','tld_biz','tld_uk','tld_dev']) assert.ok(result.codes.includes(code),code);
assert.ok(!result.codes.includes('tld_co'));
assert.equal((await request('/api/achievements/share',{url:'https://example.dev/'})).status,200);
assert.equal((await request('/api/achievements/unlocked')).body.items.find(a => a.code === 'share_first').url,'https://example.dev/');
assert.equal((await request('/api/progress')).body.visits,3);
const me = await request('/api/auth/me');
assert.equal(me.headers.get('cache-control'),'no-store');
assert.equal(me.headers.get('access-control-allow-origin'),null);
assert.equal((await request('/api/account/username',{username:'changed'})).status,409);
assert.equal((await request('/api/achievements/share',{},'POST',{origin:'https://attacker.invalid'})).status,403);
assert.equal((await request('/api/achievements/share',{},'POST',{'content-type':'text/plain'})).status,415);

const bob = await register(`other_${randomUUID().slice(0,8)}`);
const aliceToken = await issueVisitReceipt(secret,'https://example.com/',alice.user.id);
assert.equal((await request('/api/visits',{url:'https://example.com/',visitToken:aliceToken})).status,403,'another account cannot claim a bound receipt');
const token = await issueVisitReceipt(secret,'https://example.net/',bob.user.id);
const replayResults = await Promise.all(Array.from({length:3},()=>request('/api/visits',{url:'https://example.net/',visitToken:token})));
assert.deepEqual(replayResults.map(r=>r.status).sort(),[201,409,409],'concurrent replay counts once');
assert.equal((await request('/api/progress')).body.visits,1);
sql(`UPDATE users SET username=NULL WHERE id='${bob.user.id}'`);
assert.equal((await request('/api/auth/me')).body.user.needsUsername,true);
assert.equal((await request('/api/visits',{url:'https://example.com/',visitToken:token})).body.code,'USERNAME_REQUIRED');
assert.equal((await request('/api/account/username',{username:'mail@example.com'})).status,400);
assert.equal((await request('/api/account/username',{username:name.toUpperCase()})).status,409);
const chosen = `chosen_${randomUUID().slice(0,8)}`;
assert.equal((await request('/api/account/username',{username:chosen,userId:alice.user.id})).status,200);
assert.equal((await request('/api/auth/me')).body.user.username,chosen);
assert.equal((await request('/api/progress')).body.visits,1,'existing progress survives username setup');
cookie = alice.cookie;
assert.equal((await request('/api/auth/me')).body.user.username,name,'username updates cannot change another account');

// Two incomplete accounts racing for the same name: database uniqueness wins.
const racerA = await register(`racea_${randomUUID().slice(0,8)}`);
const racerB = await register(`raceb_${randomUUID().slice(0,8)}`);
sql(`UPDATE users SET username=NULL WHERE id IN ('${racerA.user.id}','${racerB.user.id}')`);
const raceName = `race_${randomUUID().slice(0,8)}`;
const claims = await Promise.all([racerA,racerB].map((actor,index)=>fetch(origin+'/api/account/username',{
  method:'POST',headers:{'content-type':'application/json',connection:'close',cookie:actor.cookie},body:JSON.stringify({username:index ? raceName.toUpperCase() : raceName})
})));
assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
// A full rolling window is enforced in D1, even if another Worker handles the next request.
sql(`INSERT INTO visits(user_id,url,visited_at) VALUES ${Array.from({length:8},()=>`('${alice.user.id}','https://fixture.example/',datetime('now','+10 seconds'))`).join(',')}`);
cookie = alice.cookie;
const rateToken = await issueVisitReceipt(secret,'https://example.org/',alice.user.id);
assert.equal((await request('/api/visits',{url:'https://example.org/',visitToken:rateToken})).status,429);
sql(`DELETE FROM visits WHERE user_id='${alice.user.id}' AND url='https://fixture.example/'`);

cookie = '';
const leaderboard = await request('/api/leaderboard?limit=999999&userId=anything&sort=email');
assert.equal(leaderboard.status,200);
assert.equal(leaderboard.headers.get('set-cookie'),null);
assert.equal(leaderboard.headers.get('cache-control'),'no-store');
assert.deepEqual(Object.keys(leaderboard.body),['items']);
assert.ok(leaderboard.body.items.length <=100);
assert.ok(leaderboard.body.items.some(row=>row.username===name && row.visits===3));
for (const row of leaderboard.body.items) {
  assert.deepEqual(Object.keys(row).sort(),['rank','username','visits']);
  assert.ok(!row.username.includes('@'));
}
for (let i=1;i<leaderboard.body.items.length;i++) assert.ok(leaderboard.body.items[i-1].visits >= leaderboard.body.items[i].visits);
assert.ok(!JSON.stringify(leaderboard.body).includes('example.invalid'));
assert.equal((await request('/api/achievements/unlocked')).status,401);
cookie = alice.cookie;
await request('/api/auth/logout',{});
assert.equal((await request('/api/achievements/unlocked')).status,401);
console.log('Local D1 integration passed: private leaderboard projection, totals, receipt verification and concurrent replay, CSRF, username setup/collisions/races, existing awards, logout.');
