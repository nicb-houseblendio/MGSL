/**
 * Feedback 16 (Marc-Antoine, 2026-09-22 18:01): « un toggle pour que les coûts
 * s'affichent en CAD (default en USD) ». The two cost selectors take the choice;
 * USD stays the default so every existing caller and Feedback 9's rule are
 * unchanged. Source guards for the wiring, since this repo cannot render.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rowCostDisplay, lotCostDisplay } from './archLots.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', p), 'utf8');

const row = { avgCostPerUnit: 2.31, avgCostPerUnitUsd: 1.66 };
const rowNoUsd = { avgCostPerUnit: 2.31, avgCostPerUnitUsd: null };

test('toggle: CAD shows what NetSuite holds, USD stays the default', () => {
  assert.deepEqual(rowCostDisplay(row), { value: 1.66, currency: 'USD' }, 'default unchanged');
  assert.deepEqual(rowCostDisplay(row, 'USD'), { value: 1.66, currency: 'USD' });
  assert.deepEqual(rowCostDisplay(row, 'CAD'), { value: 2.31, currency: 'CAD' });
  assert.deepEqual(rowCostDisplay(rowNoUsd, 'USD'), { value: 2.31, currency: 'CAD' }, 'no rate: CAD, labelled');
  assert.deepEqual(rowCostDisplay({ avgCostPerUnit: null, avgCostPerUnitUsd: 1.5 }, 'CAD'), { value: null, currency: 'CAD' },
    'CAD mode never shows a USD figure');
});

test('toggle: a bundle in CAD is its own CAD cost, else the row CAD average, never USD', () => {
  const lot = { costPerUnit: 2.5, costPerUnitUsd: 1.8 };
  assert.deepEqual(lotCostDisplay(lot, row, 'CAD'), { value: 2.5, currency: 'CAD' });
  assert.deepEqual(lotCostDisplay(lot, row), { value: 1.8, currency: 'USD' }, 'default unchanged');
  assert.deepEqual(lotCostDisplay({ costPerUnit: null, costPerUnitUsd: 1.8 }, row, 'CAD'), { value: 2.31, currency: 'CAD' });
  assert.deepEqual(lotCostDisplay({ costPerUnit: null, costPerUnitUsd: null }, { avgCostPerUnit: null, avgCostPerUnitUsd: 1 }, 'CAD'),
    { value: null, currency: 'CAD' });
});

test('toggle wiring: ARCH only, remembered safely, reaches grid, drawer and export', () => {
  const app = src('App.tsx');
  assert.match(app, /\{isARCH && \(\s*<div[\s\S]{0,400}Cost<\/span>/, 'the control renders for ARCH only');
  assert.match(app, /costCurrency=\{archCostCur\}/);
  const lots = src('lib/archLots.ts');
  assert.match(lots, /try \{\s*return window\.localStorage\.getItem\(COST_PREF_KEY\) === 'CAD' \? 'CAD' : 'USD';/);
  assert.match(lots, /try \{\s*window\.localStorage\.setItem\(COST_PREF_KEY, c\);/);
  const scr = src('components/ArchScreen.tsx');
  assert.match(scr, /<InventoryTableARCH\s+costCurrency=\{costCurrency\}/);
  assert.match(scr, /<DetailDrawerARCH\s+costCurrency=\{costCurrency\}/);
  assert.match(scr, /exportToExcelARCH\(rows, getTotals\(rows\), uom, costCurrency\)/);
  assert.match(src('components/DetailDrawerARCH.tsx'), /<ArchLotTable\s+costCurrency=\{costCurrency\}/);
  assert.match(src('components/InventoryTableARCH.tsx'), /readyToBuildSourced, costCurrency\]\);/, 'the column re-renders on a switch');
  // The SO wizard prices against CAD cost converted to the order currency; the
  // display toggle must never reach it.
  assert.match(src('lib/archOrderPricing.ts'), /COST_CURRENCY = 'CAD'/);
  assert.doesNotMatch(src('components/arch/SOWizard.tsx'), /costCurrency|archCostCur/);
});
