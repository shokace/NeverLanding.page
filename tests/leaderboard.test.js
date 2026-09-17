import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {issueVisitReceipt,verifyVisitReceipt} from '../lib/visit-receipts.js';
import {isPublicUsername,leaderboardResponse} from '../lib/leaderboard.js';
globalThis.crypto ||= webcrypto;
const secret = 'test-only-signing-secret-'.repeat(3);

test('receipts bind destination and account, expire, and reject tampering',async()=>{
  const now = Date.now();
  const token = await issueVisitReceipt(secret,'https://example.biz/','alice',now);
  assert.ok(await verifyVisitReceipt(secret,token,'https://example.biz/','alice',now));
  assert.equal(await verifyVisitReceipt(secret,token,'https://example.com/','alice',now),null);
  assert.equal(await verifyVisitReceipt(secret,token,'https://example.biz/','bob',now),null);
  assert.equal(await verifyVisitReceipt(secret,token,'https://example.biz/','alice',now+600000),null);
  assert.equal(await verifyVisitReceipt(secret,token,'https://example.biz/','alice',now-60000),null);
  assert.equal(await verifyVisitReceipt(secret,token+'.junk','https://example.biz/','alice',now),null);
  const [payload,sig] = token.split('.');
  const changed = JSON.parse(Buffer.from(payload,'base64url').toString());
  changed.sub = 'bob';
  assert.equal(await verifyVisitReceipt(secret,Buffer.from(JSON.stringify(changed)).toString('base64url')+'.'+sig,'https://example.biz/','bob',now),null);
  assert.equal(await verifyVisitReceipt('another-secret'.repeat(3),token,'https://example.biz/','alice',now),null);
  assert.equal(await verifyVisitReceipt(secret,'x'.repeat(9000),'https://example.biz/','alice',now),null);
  assert.equal(await verifyVisitReceipt(secret,token,'https://example.biz/',null,now),null);
  const guest = await issueVisitReceipt(secret,'https://example.biz/',null,now);
  assert.ok(await verifyVisitReceipt(secret,guest,'https://example.biz/','alice',now),'a page queued before signing in can count');
});

test('public projection excludes private account fields and unsafe names; ties share rank',async()=>{
  for(const bad of ['','a@example.com','<img src=x>','name\n','name with spaces','x'.repeat(33)]) assert.equal(isPublicUsername(bad),false);
  const env = {DB:{prepare(sql){assert.ok(!/SELECT\s+\*/i.test(sql));assert.ok(!/email|avatar|display_name|session|url/i.test(sql));return {all:async()=>({results:[
    {username:'Alice',visits:10,email:'private@example.com',id:'secret-id',session_token:'secret-token'},
    {username:'Bob',visits:10,email:'another@example.com'},
    {username:'unsafe@example.com',visits:9},
    {username:'Carol',visits:8},
  ]})};}}};
  const response = await leaderboardResponse(env,new Request('https://game.test/api/leaderboard?email=anything'));
  assert.deepEqual(await response.json(),{items:[{rank:1,username:'Alice',visits:10},{rank:1,username:'Bob',visits:10},{rank:3,username:'Carol',visits:8}]});
  assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  const failed = await leaderboardResponse({DB:{prepare(){throw new Error('SQL SELECT private@email.invalid');}}},new Request('https://game.test/api/leaderboard'));
  assert.equal(failed.status,503);
  assert.ok(!(await failed.text()).includes('private@'));
  assert.equal(failed.headers.get('cache-control'),'no-store');
});

test('migrations preserve totals, reject case collisions and receipt replays, and isolate incomplete accounts',()=>{
  const result = spawnSync('python3',['-c',`
import sqlite3,pathlib
c=sqlite3.connect(':memory:')
c.execute('PRAGMA foreign_keys=ON')
for p in sorted(pathlib.Path('migrations').glob('*.sql')):
 if p.name < '0012':c.executescript(p.read_text())
for uid,name in [('a','Explorer'),('b','explorer'),('c',None),('d','mail@example.com')]:
 c.execute('INSERT INTO users(id,username) VALUES(?,?)',(uid,name))
for uid in ['a','a','b','d']:
 c.execute('INSERT INTO visits(user_id,url) VALUES(?,?)',(uid,'https://example.com/'))
for p in sorted(pathlib.Path('migrations').glob('*.sql')):
 if p.name >= '0012':c.executescript(p.read_text())
assert dict(c.execute('SELECT user_id,visits FROM user_visit_totals'))=={'a':2,'b':1,'d':1}
assert dict(c.execute('SELECT id,username FROM users'))=={'a':'Explorer','b':None,'c':None,'d':None}
try:c.execute("UPDATE users SET username='EXPLORER' WHERE id='c'");assert False
except sqlite3.IntegrityError:pass
c.execute("INSERT INTO visits(user_id,url,visit_token_id) VALUES('a','https://example.org/','receipt')")
c.execute("INSERT OR IGNORE INTO visits(user_id,url,visit_token_id) VALUES('b','https://example.org/','receipt')")
assert dict(c.execute('SELECT user_id,visits FROM user_visit_totals'))=={'a':3,'b':1,'d':1}
c.execute("DELETE FROM visits WHERE visit_token_id='receipt'")
assert c.execute("SELECT visits FROM user_visit_totals WHERE user_id='a'").fetchone()[0]==2
c.execute("DELETE FROM users WHERE id='a'")
assert not c.execute("SELECT * FROM user_visit_totals WHERE user_id='a'").fetchall()
assert not c.execute('PRAGMA foreign_key_check').fetchall()
`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
