/**
 * Feedback 13 round-1 review, 2026-09-22. On ARC the native ship date equals the
 * order date on 32 of 35 SOs because NetSuite defaults it, so "Ship Week" was
 * printing the day an order was ENTERED as if it were a plan (SO 115774: Sep 9,
 * 13 days in the past). And four columns with genuinely no data rendered a bare
 * dash that read as the same bug MA had just reported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shipWeekCell, SHIP_DATE_DEFAULTED_TITLE, NO_VALUE } from './archLotOrders.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');

test('a ship date equal to the order date is a dash with the reason', () => {
  assert.deepEqual(shipWeekCell('2026-09-09', '2026-09-09'), { text: NO_VALUE, title: SHIP_DATE_DEFAULTED_TITLE });
});

test('a real ship date is shown, with no title', () => {
  const c = shipWeekCell('2026-10-02', '2026-09-09');
  assert.notEqual(c.text, NO_VALUE);
  assert.equal(c.title, undefined);
});

test('no ship date is a plain dash; no created date never hides a real ship date', () => {
  assert.deepEqual(shipWeekCell('', '2026-09-09'), { text: NO_VALUE });
  assert.notEqual(shipWeekCell('2026-10-02', '').text, NO_VALUE);
});

test('a caller-supplied formatter is honoured (Open Orders prints "Oct 2")', () => {
  assert.equal(shipWeekCell('2026-10-02', '2026-09-09', () => 'X').text, 'X');
});

test('every ARCH Ship Week cell goes through shipWeekCell', () => {
  const lot = read('components/arch/ArchLotTable.tsx');
  const res = read('components/arch/ArchReservedSection.tsx');
  const oo = read('components/arch/ArchOpenOrdersView.tsx');
  assert.match(lot, /shipWeekCell\(o\.shipDate, o\.created\)\.text/);
  assert.match(res, /shipWeekCell\(order\.shipDate, order\.created\)/);
  assert.match(oo, /shipWeekCell\(o\.shipDate, o\.created, shipWeek\)\.text/);
  assert.doesNotMatch(oo, /\{shipWeek\(o\.shipDate\)\}/);
});

test('the four no-data columns explain their dash', () => {
  const lot = read('components/arch/ArchLotTable.tsx');
  assert.match(lot, /title=\{lot\.containerNo \? undefined : NO_CONTAINER_TITLE\}/);
  assert.match(lot, /title=\{row\.grain \? undefined : NO_GRAIN_TITLE\}/);
  // Each title is computed exactly as its own cell renders (round-2 review):
  assert.match(lot, /title=\{hasLengths\(lot\) \? undefined : NO_TALLY_TITLE\}/);
  assert.match(lot, /title=\{hasAvgWidth\(lot\) \? undefined : NO_TALLY_TITLE\}/);
});

test('round 2: a locked bundle does not print its remainder in green, and says why', () => {
  const lot = read('components/arch/ArchLotTable.tsx');
  assert.match(lot, /color: freeBF > 0 && commitmentOn\(lot\) === 0 \? '#1B5E20' : ARCH_SURFACE\.textLight,/);
  assert.match(lot, /Locked until this bundle is split/);
  assert.doesNotMatch(lot, /can contribute: its on-hand less anything reserved/);
});

test('round 2: the tally-image dash only mentions an image when there is one', () => {
  const lot = read('components/arch/ArchLotTable.tsx');
  assert.match(lot, /title=\{hasImage\s*\n?\s*\? 'No system tally on this lot, open the attached tally image'/);
});

test('round 2: a mix of a defaulted and a real ship date shows the real one', () => {
  const lot = read('components/arch/ArchLotTable.tsx');
  assert.match(lot, /\.filter\(\(t\) => t !== NO_VALUE\)\)\.text/);
});

test('round 2: the Reserved panel container dash explains itself too', () => {
  const res = read('components/arch/ArchReservedSection.tsx');
  assert.match(res, /No container recorded: no vessel on its inventory adjustment, and no Seal \/ Trailer # on its PO\./);
});

test('round 2 (F12): an append does not preload a defaulted ship date', () => {
  const wiz = read('components/arch/SOWizard.tsx');
  assert.match(wiz, /setShipDate\(o\.shipDate && o\.shipDate !== o\.created \? o\.shipDate : ''\);/);
  assert.doesNotMatch(wiz, /setShipDate\(o\.shipDate \|\| ''\);/);
});

test('round 2 (F12): only the RESTlet leg claims the list may be incomplete', () => {
  const oo = read('components/arch/ArchOpenOrdersView.tsx');
  assert.match(oo, /transport === 'restlet' \? 'This list may not be complete\.' : 'Some figures on this tab are incomplete\.'/);
});

test('round 2 (F12): the append guard reads the status LETTER, so SalesOrd:G is refused', () => {
  const oc = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js'), 'utf8');
  const at = oc.indexOf('const assertAppendable = (soId) =>');
  const body = oc.slice(at, oc.indexOf('return { tranId: rows[0].tranid', at));
  assert.doesNotMatch(body, /const code = String\(rows\[0\]\.status \|\| ''\)\.toUpperCase\(\);/);
  // Execute the extraction on both dialects' spellings.
  const letter = (raw) => { const s = String(raw || '').trim(); return s.slice(s.lastIndexOf(':') + 1).toUpperCase(); };
  assert.match(body, /rawStatus\.slice\(rawStatus\.lastIndexOf\(':'\) \+ 1\)\.toUpperCase\(\)/);
  assert.equal(letter('SalesOrd:G'), 'G');
  assert.equal(letter('G'), 'G');
  assert.equal(letter('SalesOrd:B'), 'B');
});
