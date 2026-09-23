/**
 * Feedback 17 item 2 (Tally), second pass 2026-09-23: which lot names a captured
 * tally bundle is matched under, in the ARCH cache MR.
 *
 * Nic's contract (houseblend-clients master, Tally/record-format.md and
 * payload-template.json) writes `po` as "PO-314888" and leaves `lot` null unless
 * a receipt created the lot. 1,033 of the 1,053 on-hand ARC lots in sandbox came
 * in by adjustment, so a push that follows it would have matched almost nothing.
 * The function is lifted out of the MR source and run for real, not guarded by regex.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mr = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js'), 'utf8');
const start = mr.indexOf('const tallyLotKeys = (po, b) => {');
const end = mr.indexOf('\n            };', start) + '\n            };'.length;
assert.ok(start > 0 && end > start, 'tallyLotKeys is in the MR');
const tallyLotKeys = new Function(mr.slice(start, end) + '\nreturn tallyLotKeys;')();

test('the seeds keep matching exactly as before', () => {
  assert.deepEqual(tallyLotKeys('314307', { lot: '1535' }), ['1535', '314307-1535']);
  assert.deepEqual(tallyLotKeys('315643', { lot: '315643-5' }), ['315643-5']);
});

test('Nic\'s "PO-314888" form also tries the bare supplier number', () => {
  assert.deepEqual(tallyLotKeys('PO-314888', { lot: '314888-12' }), ['314888-12', 'PO-314888-314888-12']);
  assert.ok(tallyLotKeys('PO-314888', { lot: '12' }).includes('314888-12'));
});

test('a null lot falls back to <PO>-<bundleNo>, never to the bare bundle number', () => {
  const k = tallyLotKeys('PO-314888', { lot: null, bundleNo: '7' });
  assert.deepEqual(k, ['PO-314888-7', '314888-7']);
  assert.ok(!k.includes('7'), 'a bare "7" would meet any lot called 7');
});

test('nothing to match on gives no key at all', () => {
  assert.deepEqual(tallyLotKeys('', { lot: null, bundleNo: '7' }), []);
  assert.deepEqual(tallyLotKeys('PO-1', { lot: null, bundleNo: null }), []);
  assert.deepEqual(tallyLotKeys('PO-1', null), []);
});

test('keys are upper-cased and de-duplicated', () => {
  assert.deepEqual(tallyLotKeys('314307', { lot: '314307-1535', bundleNo: '1535' }), ['314307-1535']);
  assert.deepEqual(tallyLotKeys(' po-9 ', { lot: 'a1' }), ['A1', 'PO-9-A1', '9-A1']);
});
