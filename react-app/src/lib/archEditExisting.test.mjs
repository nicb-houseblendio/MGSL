/**
 * Feedback 16 (MA, 2026-09-22 18:01), items 1 and 2: « Edit SO (from the Open SO
 * tab), SO-ARC-26, le bundle split info est disparu (lot BF est 100 vs le 373 on
 * hand). Reman info : même affaire. »
 *
 * NetSuite held both (line 1 split T, 100 BF, cut 10'; line 7 plane 15/16); the
 * open-orders payload never carried them and sent the ASSIGNED quantity as the
 * line's size. The fixtures below are SO-ARC-26's live payload after the fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toCartLine } from '../hooks/useArchOpenOrders.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', p), 'utf8');

const base = { key: 'so:SO-ARC-26|1|52660', internalId: '3001', itemCode: 'AFM44KDSRT', description: 'African Mahogany 4/4 KD SRT',
  thickness: '4/4', locationName: 'Prevost (PBF)', locationId: '151', lotNo: '313989-17', lotId: '52660', containerNo: '',
  unitName: 'BF', bf: 100, costPerBF: 2, bucket: 'reserve' };

test('an existing SPLIT line shows the bundle it is cut from, and its split', () => {
  const l = toCartLine({ ...base, lotQty: 473, split: { on: true, bf: 100, status: 'Pending' },
    reman: { planing: false, planeTarget: '', cutting: true, cutLength: "10'" } });
  assert.equal(l.preSplitQty, 473, 'Lot BF is the bundle, not the 100 on the order');
  assert.deepEqual(l.existingSplit, { on: true, targetBF: '100' });
  assert.deepEqual(l.existingReman, { planing: false, planingSpec: '', planingOther: '', cutting: true, cutLength: "10'" });
});

test('an existing whole-bundle line keeps its own quantity, and its planing', () => {
  const l = toCartLine({ ...base, lotNo: '316078-8', bf: 462, lotQty: 462,
    reman: { planing: true, planeTarget: '15/16', cutting: false, cutLength: '' } });
  assert.equal(l.preSplitQty, 462);
  assert.equal(l.existingSplit, undefined);
  assert.equal(l.existingReman.planingSpec, '15/16');
});

test('a payload without the new fields (prod before X.2, or a failed read) behaves as before', () => {
  const l = toCartLine({ ...base });
  assert.equal(l.preSplitQty, 100);
  assert.equal(l.existingSplit, undefined);
  assert.equal(l.existingReman, undefined);
  assert.equal(toCartLine({ ...base, split: { on: true, bf: 100 } }).preSplitQty, 100, 'no lot size: fall back to bf');
});

test('the wizard shows what an existing line holds, read-only (source guards)', () => {
  const w = src('components/arch/SOWizard.tsx');
  assert.match(w, /const sp = \(k: string\) => split\[k\] \|\| existingIntent\[k\]\?\.split \|\| emptySplit\(\);/);
  assert.match(w, /const rm = \(k: string\) => reman\[k\] \|\| existingIntent\[k\]\?\.reman \|\| emptyReman\(\);/);
  assert.match(w, /planingOther: r\.planingSpec, planingSpec: 'other'/, 'a non-standard stored size shows as Other');
  // Plane size, Other text and cut length: existing only. The two checkboxes also
  // lock on a non-BF line (Feedback 17 B2).
  assert.equal((w.match(/disabled=\{!!l\.existing\}/g) || []).length, 3, 'plane size, Other text, cut length read-only on an existing line');
  assert.equal((w.match(/disabled=\{!!l\.existing \|\| l\.unit !== 'BF'\}/g) || []).length, 2, 'plane and cut checkboxes: existing or non-BF');
  assert.match(w, /disabled=\{!s\.on \|\| !!l\.existing\}/);
  // And the rule that makes read-only honest: existing lines are never written.
  assert.match(w, /mode === 'existing' \? lines\.filter\(\(l\) => !l\.existing\) : lines/);
});

test('the service reads split and reman in an ISOLATED query (prod has no such fields yet)', () => {
  const s = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js'), 'utf8');
  const main = s.slice(s.indexOf('const OPEN_ORDERS_SQL'), s.indexOf('const handleGetOpenOrders'));
  assert.doesNotMatch(main, /custcol_mgsl_split|custcol_mgsl_reman/, 'never in the main query, which would blank the tab in prod');
  assert.match(s, /tl\.custcol_mgsl_split AS sp, tl\.custcol_mgsl_split_bf AS spbf/);
  assert.match(s, /split\/reman or lot size not readable \(non-fatal/);
});

/* Feedback 17 item 4 (MA, 2026-09-23): « Ship date et equipment ne semble pas suivre ». */
test('F17-4: Edit restores the order\'s Equipment, note and a same-day or future ship date', () => {
  const w = src('components/arch/SOWizard.tsx');
  assert.match(w, /setEquipment\(o\.equipment \|\| ''\);\s*setEquipmentId\(o\.equipmentId \|\| ''\);/);
  assert.match(w, /if \(o\.memo !== undefined\) setCustomerNote\(o\.memo \|\| ''\);/);
  assert.match(w, /stored && stored >= todayIso \? stored : ''/, 'a past default is still not preloaded');
  const s = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_arch.js'), 'utf8');
  const main = s.slice(s.indexOf('const OPEN_ORDERS_SQL'), s.indexOf('const handleGetOpenOrders'));
  assert.doesNotMatch(main, /custbody_equipment/, 'the custom body field never enters the main query');
  assert.match(s, /SELECT id AS soid, custbody_equipment AS eq, BUILTIN\.DF\(custbody_equipment\) AS eqname, memo AS note/);
  assert.match(s, /shipDateStored: stored \|\| ''/);
});

/* Review 2026-09-23 (H1), a regression the Feedback 16 fix introduced: the Open SO
 * tab read `preSplitQty` as the quantity ON THE ORDER, and it became the bundle's
 * size on a split line, so SO-ARC-26 summed 935 BF (473 + 462) for an order of 562. */
test('H1: an existing split line keeps its ordered quantity apart from the bundle size', () => {
  const split = toCartLine({ ...base, lotQty: 473, split: { on: true, bf: 100, status: 'Pending' } });
  const whole = toCartLine({ ...base, lotNo: '316078-8', bf: 462, lotQty: 462 });
  assert.equal(split.preSplitQty, 473, 'the wizard still shows the bundle');
  assert.equal(split.orderedQty, 100, 'what is on the order');
  assert.equal(split.orderedQty + whole.orderedQty, 562, "SO-ARC-26's real total");
  const v = src('components/arch/ArchOpenOrdersView.tsx');
  assert.match(v, /const onOrder = \(l: ArchCartLine\): number => l\.orderedQty \?\? l\.preSplitQty;/);
  assert.match(v, /const lineProfit = \(l: ArchCartLine\) => lineRevenue\(l\) - onOrder\(l\) \* \(l\.costPerBF \?\? 0\);/);
  assert.match(v, /qty: onOrder\(l\)/);
  assert.doesNotMatch(v, /formatQty\(l\.preSplitQty, l\.unit\)/, 'the line cell shows what is ordered');
});
