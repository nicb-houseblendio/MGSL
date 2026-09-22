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
  assert.equal((lot.match(/title=\{hasTallyShape\(lot\) \? undefined : NO_TALLY_TITLE\}/g) || []).length, 2);
});
