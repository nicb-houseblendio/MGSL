/**
 * Feedback 8 step 2.8c: PO lines with no bundles are LISTED in the In Transit /
 * On Order drill-down with PO, supplier and ETA, and in-transit wood billed with
 * no packing list carries a flag on the grid. Before this, such a line vanished
 * from the drill-down, silently on a row that also had bundled lines.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { noPackingListFlag } from './archUnbundled.ts';

const here = dirname(fileURLToPath(import.meta.url));
const view = readFileSync(join(here, '../components/arch/ArchPOListView.tsx'), 'utf8');
const grid = readFileSync(join(here, '../components/InventoryTableARCH.tsx'), 'utf8');

const line = (over) => Object.assign({ poNumber: 'PO-ARC-000007', supplier: 'S', eta: '', arm: 'billed', inTransit: 900, onOrder: 0 }, over);

test('billed-ahead lines raise the flag, with the POs', () => {
  const f = noPackingListFlag({ unbundled: [line({ billedAhead: true }), line({ poNumber: 'PO-ARC-000008', inTransit: 100, billedAhead: true }), line({ inTransit: 50, billedAhead: true })] });
  assert.equal(f.qty, 1050);
  assert.deepEqual(f.poNumbers, ['PO-ARC-000007', 'PO-ARC-000008']);
});

test('the flag follows billedAhead, not the arm: journal+billed raises it, journal alone does not', () => {
  assert.notEqual(noPackingListFlag({ unbundled: [line({ arm: 'journal', billedAhead: true })] }), null);
  assert.equal(noPackingListFlag({ unbundled: [line({ arm: 'journal', billedAhead: false }), line({ arm: 'none', inTransit: 0, onOrder: 500 })] }), null);
  assert.equal(noPackingListFlag({ unbundled: [line({ arm: 'billed' })] }), null, 'arm billed without billedAhead is not flagged');
  assert.equal(noPackingListFlag({ unbundled: [] }), null);
  assert.equal(noPackingListFlag({}), null);
});

// Executed, not grepped (round-1 review): the footer arithmetic and the badge choice.
import { poListTotals, unbundledBadge } from './archUnbundled.ts';

const row = (over) => Object.assign({ lots: [], unbundled: [], onOrder: 0, inTransit: 0 }, over);
const lot = (over) => Object.assign({ lotNo: 'X-1', onOrder: 0, inTransit: 0 }, over);

test('footer always equals the tab: bundles + unbundled + residual = row figure', () => {
  const r = row({ onOrder: 3000, lots: [lot({ onOrder: 1000 })], unbundled: [line({ arm: 'none', inTransit: 0, onOrder: 1500 })] });
  const t = poListTotals(r, 'onOrder');
  assert.equal(t.total, 3000);
  assert.equal(t.residual, 500);
  assert.equal(t.lotTotal + t.unbundledTotal + t.residual, t.total);
});

test('a bundle the lot query did not return is a residual line, not "no bundle numbers yet"', () => {
  const t = poListTotals(row({ onOrder: 2000 }), 'onOrder');
  assert.equal(t.residual, 2000);
  assert.equal(t.lots.length + t.unbundled.length, 0);
});

test('lots over-claiming the row show a NEGATIVE residual, so the footer still equals the tab', () => {
  const t = poListTotals(row({ onOrder: 1000, lots: [lot({ onOrder: 2000 })] }), 'onOrder');
  assert.equal(t.residual, -1000);
  assert.equal(t.total, 1000);
});

test('dust under half a unit is dropped from both the lines and the residual', () => {
  const t = poListTotals(row({ onOrder: 1000.3, lots: [lot({ onOrder: 1000 })], unbundled: [line({ arm: 'none', inTransit: 0, onOrder: 0.3 })] }), 'onOrder');
  assert.equal(t.unbundled.length, 0);
  assert.equal(t.residual, 0);
});

test('an older payload with no unbundled field: the whole gap is the residual', () => {
  const t = poListTotals(row({ onOrder: 3000, lots: [lot({ onOrder: 1000 })], unbundled: undefined }), 'onOrder');
  assert.equal(t.residual, 2000);
});

test('badge by state and TAB', () => {
  assert.equal(unbundledBadge(line({ arm: 'closed', billedAhead: false }), 'onOrder').text, 'PO closed');
  assert.equal(unbundledBadge(line({ arm: 'billed', billedAhead: true }), 'inTransit').text, 'No packing list');
  // the un-billed part of a partly billed line, on the On Order tab
  assert.equal(unbundledBadge(line({ arm: 'billed', billedAhead: true }), 'onOrder').text, 'No bundles yet');
  assert.equal(unbundledBadge(line({ arm: 'none', billedAhead: false, partlyReceived: true }), 'onOrder').text, 'Partly received');
  assert.equal(unbundledBadge(line({ arm: 'journal', billedAhead: false }), 'inTransit').text, 'No bundles yet');
});

test('per-tab line count, with the older-payload fallback', async () => {
  const { linesOnTab } = await import('./archUnbundled.ts');
  assert.equal(linesOnTab(line({ lineCount: 2, onOrderLines: 1, inTransitLines: 2 }), 'onOrder'), 1);
  assert.equal(linesOnTab(line({ lineCount: 2, onOrderLines: 1, inTransitLines: 2 }), 'inTransit'), 2);
  assert.equal(linesOnTab(line({ lineCount: 3 }), 'onOrder'), 3);
});

test('the view: Ship week header, per-tab counts, a footer that never says "on 0 purchase orders"', () => {
  assert.match(view, /'Ship week', `\$\{label\}/);
  assert.doesNotMatch(view, /'Container \/ Vessel', 'ETA'/);
  assert.match(view, /linesOnTab\(u, bucket\) > 1 &&/);
  assert.match(view, /: 'Not listed bundle by bundle';/);
  assert.match(view, /SHIP_WEEK_DEFAULTED_TITLE/);
});

test('the view is wired to the tested functions', () => {
  assert.match(view, /const \{ lots, unbundled, residual, total \} = poListTotals\(row, bucket\);/);
  assert.match(view, /const badge = unbundledBadge\(u, bucket\);/);
  assert.match(view, /if \(lots\.length === 0 && unbundled\.length === 0 && residual <= 0\) \{/);
});

test('the grid In Transit cell carries the flag', () => {
  assert.match(grid, /const npl = bucket === 'inTransit' \? noPackingListFlag\(row\) : null;/);
  assert.match(grid, /aria-label="No packing list"/);
});
