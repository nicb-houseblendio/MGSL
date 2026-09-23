/**
 * Feedback 17 item 2 (Tally), second pass 2026-09-23: which lot a captured tally
 * bundle is attached to, in the ARCH cache MR.
 *
 * Nic's contract (houseblend-clients master, Tally/record-format.md and
 * payload-template.json) writes `po` as "PO-314888" and leaves `lot` null unless
 * a receipt created the lot. 1,033 of the 1,053 on-hand ARC lots in sandbox came
 * in by adjustment, so a push that follows it would have matched almost nothing.
 * The helpers are lifted out of the MR source and run for real, not regex-guarded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mr = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js'), 'utf8').replace(/\r\n/g, '\n');
const START = 'const tallyUp = (v) =>';
const END_MARK = 'return (lotPos || []).some((lp) => tallyPoForms(lp).some((f) => forms.indexOf(f) !== -1));\n    };';
const start = mr.indexOf(START);
const end = mr.indexOf(END_MARK, start) + END_MARK.length;
assert.ok(start > 0 && end > start, 'the tally key helpers are in the MR, at module scope');
const { tallyLotKeys, tallyLotAnchored } =
  new Function(mr.slice(start, end) + '\nreturn { tallyLotKeys, tallyLotAnchored };')();

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

test('an exact lot key attaches only when the capture\'s PO is the lot\'s PO', () => {
  // The seeds: the lot name starts with the capture PO.
  assert.equal(tallyLotAnchored('314307', '314307-1535', ['314307', undefined]), true);
  // A bundle number written into `lot` ("2006") must not land on the unrelated
  // bare-numbered lot 2006 (WEN44KD in sandbox), which has no PO at all.
  assert.equal(tallyLotAnchored('314307', '2006', ['', undefined]), false);
  // A receipt lot is anchored through the PO it was received on.
  assert.equal(tallyLotAnchored('PO-ARC-000005', '000005-2', ['000005', 'PO-ARC-000005']), true);
  assert.equal(tallyLotAnchored('PO-314888', '314888-12', ['314888', undefined]), true);
  // Another PO's lot is refused even when the name matches.
  assert.equal(tallyLotAnchored('PO-314888', 'LOT-9', ['', 'PO-999999']), false);
  // No PO on the capture: nothing to check against, the exact-name rule stands.
  assert.equal(tallyLotAnchored('', '2006', ['', undefined]), true);
});

test('the join goes through the anchor, and each tally carries its capture PO', () => {
  assert.match(mr, /const tally = tallyHit && tallyLotAnchored\(tallyHit\.po, l\.lotNo,\s*\[poFromLotNo\(l\.lotNo\), \(lotFacts\[String\(l\.lotId\)\] \|\| \{\}\)\.poNumber\]\)/);
  assert.match(mr, /po:\s+payload\.po \|\| '',/);
});
