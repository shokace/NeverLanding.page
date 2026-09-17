import test from 'node:test';
import assert from 'node:assert/strict';
import {candidates,parseDomains,supplementalSites} from '../lib/discovery.js';

test('catalog expands subject and TLD coverage without adding image assets', () => {
  assert.ok(supplementalSites.length >= 600);
  assert.ok(new Set(supplementalSites.map(host => host.split('.').at(-1))).size >= 220);
});

test('CSV parsing rejects corrupt domains and accepts rare TLDs irrespective of rank', () => {
  assert.deepEqual(parseDomains('1,example.com\n999999,nic.vc\n1000000,nic.zip\n5,https://bad.example/path\n6,host,extra\n7,127.0.0.1'), ['example.com','nic.vc','nic.zip']);
});

test('R2 sampling reaches the tail of the list, ignores popularity, and deduplicates candidates', async () => {
  const original = Math.random;
  let seed = 434;
  Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2**32);
  const csv = Array.from({length:10000},(_,i) => `${990000+i},site${i}.com\n`).join('');
  const ranges = [];
  const env = {TRANCO_R2_KEY:'test-tail.csv',TRANCO_BUCKET:{head:async()=>({size:csv.length}),get:async(_,options)=>{
    ranges.push(options.range);return {text:async()=>csv.slice(options.range.offset,options.range.offset+options.range.length)};
  }}};
  try {
    const result = await candidates(env,12);
    assert.equal(result.length,12);
    assert.equal(new Set(result.map(a => a.url)).size,12);
    assert.ok(result.some(a => /site\d+\.com/.test(a.url)));
    assert.ok(ranges[0].offset > 0);
    assert.ok(result.every(a => !('rank' in a)), 'rank is not used for weighting');
  } finally {Math.random = original;}
});
