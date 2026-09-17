import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {definitions, countryCodes, earnedCodes, visitTld} from '../lib/achievements.js';

test('every displayed icon has a unique definition, real asset, and implemented rule', () => {
  const catalog = JSON.parse(fs.readFileSync('public/data/achievements.json'));
  assert.equal(catalog.slots, definitions.length);
  assert.equal(new Set(definitions.map(a => a.code)).size, definitions.length);
  for (const a of definitions) {
    assert.ok(a.title && a.description && a.description !== '???');
    assert.ok(fs.existsSync(`public${a.icon}`), a.icon);
    assert.ok(['tld', 'visits', 'passport', 'login', 'share'].includes(a.rule.type), a.code);
    if (a.country) assert.equal(a.code, `tld_${a.rule.value}`);
  }
  const used = new Set(definitions.map(a => a.icon.split('/').at(-1)));
  for (const icon of fs.readdirSync('public/assets/achievements').filter(f => f.endsWith('.ico'))) assert.ok(used.has(icon), icon);
});

test('every active TLD achievement unlocks only for that final hostname label', () => {
  for (const a of definitions.filter(a => a.rule.type === 'tld' && a.available !== false)) {
    const code = a.code;
    assert.ok(earnedCodes({urls: [`https://school.example.${a.rule.value}/`]}).includes(code), code);
    assert.ok(!earnedCodes({urls: [`https://${a.rule.value}.example.invalid/${a.rule.value}`]}).includes(code), code);
    assert.ok(!earnedCodes({urls: [`https://example.com/?tld=.${a.rule.value}`]}).includes(code) || a.rule.value === 'com');
  }
});

test('existing login, share, biz and explorer milestones remain compatible', () => {
  assert.ok(earnedCodes({}).includes('login_first'));
  assert.ok(earnedCodes({shares: 1}).includes('share_first'));
  assert.ok(earnedCodes({urls: ['https://shop.example.biz/']}).includes('tld_biz'));
  assert.ok(!earnedCodes({visits: 99}).includes('explorer_level_1'));
  assert.ok(earnedCodes({visits: 100}).includes('explorer_level_1'));
  assert.ok(!earnedCodes({visits: 2025}).includes('explorer_level_2'));
  assert.ok(earnedCodes({visits: 2026}).includes('explorer_level_2'));
  const historical = ['tld_mf', 'explorer_level_3', 'unknown_legacy_award'];
  for (const code of historical) assert.ok(earnedCodes({unlocked: historical}).includes(code));
});

test('passport unlocks on the final country visit without unavailable .mf or unrelated generic TLDs', () => {
  const allButLast = countryCodes.slice(0, -1);
  const last = countryCodes.at(-1).slice(4);
  assert.ok(!earnedCodes({visits: 2026, unlocked: allButLast}).includes('explorer_level_3'));
  assert.ok(!earnedCodes({visits: 2025, unlocked: countryCodes}).includes('explorer_level_3'));
  assert.ok(earnedCodes({visits: 2026, unlocked: allButLast, urls: [`https://example.${last}`]}).includes('explorer_level_3'));
  assert.ok(!countryCodes.includes('tld_mf'));
  assert.ok(countryCodes.includes('tld_vc'));
});

test('TLD parsing rejects scripts, IPs, credentials and deceptive paths', () => {
  for (const url of ['javascript:alert(1)', 'https://127.0.0.1/', 'https://user:pass@example.com', 'bad input']) assert.equal(visitTld(url), '');
  assert.equal(visitTld('https://WWW.EXAMPLE.CO.UK.:443/path?x=.us'), 'uk');
});
