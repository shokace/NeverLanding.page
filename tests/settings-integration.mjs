import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const origin = 'http://127.0.0.1:8787'; // Disposable local D1 accounts only.
const accounts = [];
async function request(path, cookie = '', body, headers = {}) {
  const response = await fetch(origin + path, {method:body ? 'POST' : 'GET', headers:{cookie, connection:'close', 'content-type':'application/json', ...headers}, body:body && JSON.stringify(body)});
  return {status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0], headers:response.headers};
}
function sql(command) {
  return JSON.parse(execFileSync('npx', ['wrangler','d1','execute','neverlanding-dev','--local','--command',command,'--json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0].results;
}
async function register() {
  const username = `settings_${randomUUID().slice(0,8)}`, password = randomUUID(), email = `${username}@example.invalid`;
  const result = await request('/api/auth/register', '', {username,email,password});
  assert.equal(result.status,201,JSON.stringify(result.body));
  const account = {...result.body.user,cookie:result.cookie,password};
  accounts.push(account);
  return account;
}
try {
  for (const path of ['/api/account','/api/account/profile','/api/account/delete','/api/account/sessions/revoke']) {
    assert.equal((await request(path,'',path === '/api/account' ? undefined : {})).status,401);
  }
  const alice = await register(), bob = await register();
  const metadata = await request('/api/account',alice.cookie);
  assert.deepEqual(metadata.body,{hasPassword:true});
  assert.equal(metadata.headers.get('cache-control'),'no-store');
  assert.equal((await request('/api/account/profile',alice.cookie,{username:bob.username.toUpperCase()})).status,409);
  assert.equal((await request('/api/account/profile',alice.cookie,{username:'private@example.com'})).status,400);
  assert.equal((await request('/api/account/profile',alice.cookie,{username:'xy'})).status,400);
  const renamed = `new_${randomUUID().slice(0,8)}`;
  sql(`INSERT INTO visits(user_id,url) VALUES('${alice.id}','https://example.biz/'); INSERT INTO favorites(user_id,url) VALUES('${alice.id}','https://example.net/'); INSERT INTO auth_accounts(id,user_id,provider,provider_user_id,access_token,refresh_token) VALUES('${randomUUID()}','${alice.id}','google','${randomUUID()}','test-access-token','test-refresh-token')`);
  const before = (await request('/api/achievements/unlocked',alice.cookie)).body;
  assert.ok(before.codes.includes('tld_biz'));
  assert.equal((await request('/api/account/profile',alice.cookie,{username:renamed,userId:bob.id})).status,200);
  assert.equal((await request('/api/auth/me',bob.cookie)).body.user.username,bob.username);
  assert.deepEqual((await request('/api/achievements/unlocked',alice.cookie)).body,before,'rename preserves earned achievements and source URLs');
  assert.equal((await request('/api/progress',alice.cookie)).body.visits,1);
  let board = await request('/api/leaderboard');
  assert.equal(board.headers.get('cache-control'),'no-store');
  assert.ok(board.body.items.some(row=>row.username===renamed));
  assert.ok(!board.body.items.some(row=>row.username===alice.username));
  const claims = await Promise.all([alice,bob].map((actor,index)=>request('/api/account/profile',actor.cookie,{username:index ? renamed.toUpperCase() : renamed})));
  assert.deepEqual(claims.map(result=>result.status),[200,409]);
  const otherSession = await request('/api/auth/login','',{email:alice.email,password:alice.password});
  assert.equal((await request('/api/account/sessions/revoke',alice.cookie,{})).status,200);
  assert.equal((await request('/api/auth/me',otherSession.cookie)).body.user,null);
  assert.equal((await request('/api/auth/me',alice.cookie)).body.user.id,alice.id);
  assert.equal((await request('/api/auth/me',bob.cookie)).body.user.id,bob.id);
  const secondSession = await request('/api/auth/login','',{email:alice.email,password:alice.password});
  assert.equal((await request('/api/account/delete',alice.cookie,{confirmation:'DELETE',password:alice.password},{origin:'https://attacker.invalid'})).status,403);
  assert.equal((await request('/api/account/delete',alice.cookie,{confirmation:'DELETE',password:alice.password},{'content-type':'text/plain'})).status,415);
  assert.equal((await request('/api/account/delete',alice.cookie,{confirmation:'yes',password:alice.password})).status,400);
  assert.equal((await request('/api/account/delete',alice.cookie,{confirmation:'DELETE'})).status,400);
  assert.equal((await request('/api/account/delete',alice.cookie,{confirmation:'DELETE',password:'incorrect'})).status,403);
  const removed = await request('/api/account/delete',alice.cookie,{confirmation:'DELETE',password:alice.password,userId:bob.id});
  assert.equal(removed.status,200,JSON.stringify(removed.body));
  assert.equal(removed.cookie,'nl_session=');
  for (const token of [alice.cookie,secondSession.cookie]) assert.equal((await request('/api/auth/me',token)).body.user,null);
  assert.equal((await request('/api/auth/login','',{email:alice.email,password:alice.password})).status,401);
  for (const table of ['users','auth_accounts','sessions','visits','favorites','user_achievements','user_visit_totals']) {
    assert.equal(sql(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table==='users'?'id':'user_id'}='${alice.id}'`)[0].count,0,table);
  }
  assert.equal((await request('/api/auth/me',bob.cookie)).body.user.id,bob.id,'another account survives deletion');
  assert.ok((await request('/api/achievements/unlocked',bob.cookie)).body.codes.includes('login_first'));
  board = await request('/api/leaderboard');
  assert.ok(!board.body.items.some(row=>row.username===renamed),'no stale leaderboard cache after deletion');
  assert.equal((await request('/api/account/delete',alice.cookie,{confirmation:'DELETE',password:alice.password})).status,401);
  // Exercise Google-only deletion with a genuinely old session, then a fresh one.
  const google = await register();
  sql(`UPDATE users SET password_hash=NULL,password_salt=NULL WHERE id='${google.id}'; UPDATE sessions SET created_at=datetime('now','-11 minutes') WHERE user_id='${google.id}'; INSERT INTO auth_accounts(id,user_id,provider,provider_user_id) VALUES('${randomUUID()}','${google.id}','google','${randomUUID()}')`);
  assert.deepEqual((await request('/api/account',google.cookie)).body,{hasPassword:false});
  assert.equal((await request('/api/account/delete',google.cookie,{confirmation:'DELETE'})).body.code,'REAUTH_REQUIRED');
  sql(`UPDATE sessions SET created_at=datetime('now') WHERE user_id='${google.id}'`);
  assert.equal((await request('/api/account/delete',google.cookie,{confirmation:'DELETE'})).status,200);
  assert.equal(sql(`SELECT COUNT(*) AS count FROM auth_accounts WHERE user_id='${google.id}'`)[0].count,0);
  assert.equal(sql('PRAGMA foreign_key_check').length,0);
  console.log('Settings D1 integration passed: rename uniqueness/preservation, session isolation, deletion confirmation/password/recent Google login, CSRF, full cascades, and immediate leaderboard updates.');
} finally {
  if (accounts.length) sql(`DELETE FROM users WHERE id IN (${accounts.map(account=>`'${account.id}'`).join(',')})`);
}
