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
  const f = noPackingListFlag({ unbundled: [line({}), line({ poNumber: 'PO-ARC-000008', inTransit: 100 }), line({ inTransit: 50 })] });
  assert.equal(f.qty, 1050);
  assert.deepEqual(f.poNumbers, ['PO-ARC-000007', 'PO-ARC-000008']);
});

test('a journal line without bundles, or on-order only, does NOT raise it', () => {
  assert.equal(noPackingListFlag({ unbundled: [line({ arm: 'journal' }), line({ arm: 'none', inTransit: 0, onOrder: 500 })] }), null);
  assert.equal(noPackingListFlag({ unbundled: [] }), null);
  assert.equal(noPackingListFlag({}), null);
});

test('the drill-down lists unbundled lines and counts them in its footer total', () => {
  assert.match(view, /const unbundled = \(row\.unbundled \|\| \[\]\)\.filter/);
  assert.match(view, /const total = lotTotal \+ unbundledTotal \+ legacyGap;/);
  assert.match(view, /\{unbundled\.map\(\(u, i\) => \{/);
  // the early empty state no longer swallows a row whose only content is unbundled
  assert.match(view, /if \(lots\.length === 0 && unbundled\.length === 0\) \{/);
});

test('an older payload (no unbundled field) shows the gap as a line, never a short total', () => {
  assert.match(view, /const legacyGap = hasUnbundledField \? 0 : Math\.max\(0, \(row\[bucket\] \?\? 0\) - lotTotal\);/);
  assert.match(view, /On purchase order lines with no bundle numbers yet/);
});

test('the grid In Transit cell carries the flag', () => {
  assert.match(grid, /const npl = bucket === 'inTransit' \? noPackingListFlag\(row\) : null;/);
  assert.match(grid, /aria-label="No packing list"/);
});
