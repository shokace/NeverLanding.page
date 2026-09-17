import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('additive migration preserves existing achievement IDs and earned records on upgrade and rerun', () => {
  const result = spawnSync('python3', ['-c', `
import sqlite3,pathlib,json
c=sqlite3.connect(':memory:')
c.execute('PRAGMA foreign_keys=ON')
for p in sorted(pathlib.Path('migrations').glob('*.sql')):
 if p.name.startswith('0009'):continue
 c.executescript(p.read_text())
c.execute("INSERT INTO users(id,username) VALUES('old-user','explorer')")
# Deliberately use a nonstandard legacy ID to exercise ON CONFLICT preservation.
c.execute("UPDATE achievements SET id='legacy-login-id' WHERE code='login_first'")
for i,row in enumerate(c.execute('SELECT id FROM achievements').fetchall()):
 c.execute('INSERT INTO user_achievements(id,user_id,achievement_id) VALUES(?,?,?)',(str(i),'old-user',row[0]))
before=c.execute('SELECT * FROM user_achievements ORDER BY id').fetchall()
ids=dict(c.execute('SELECT code,id FROM achievements'))
migration=pathlib.Path('migrations/0009_complete_achievements.sql').read_text()
c.executescript(migration)
c.executescript(migration)
assert before==c.execute('SELECT * FROM user_achievements ORDER BY id').fetchall()
after=dict(c.execute('SELECT code,id FROM achievements'))
assert all(after[k]==v for k,v in ids.items())
definitions=json.loads(pathlib.Path('public/data/achievements.json').read_text())['achievements']
assert {a['code'] for a in definitions}==set(after)
assert not c.execute('PRAGMA foreign_key_check').fetchall()
print('Preserved',len(before),'earned awards;',len(after),'definitions available')
`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
});
