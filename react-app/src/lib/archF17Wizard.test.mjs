/**
 * Feedback 17 (Marc-Antoine, Slack 2026-09-23 10:49), the SO creation items:
 *   8a  Items: « Renommer la colonne Lot BF à Quantity », a UOM column
 *   8b  Pricing: same columns, no yellow operations & insurance box, profit =
 *       price - lot cost - reman - split, cost in the SO currency « au même taux
 *       que l'on a sur le Trader screen », no « Pricing check » pop-up
 *   8c  Remanufacturing: « Service cost est toujours en CAD »
 *   8d  leaving the wizard keeps Customer & terms
 *   B1  Freight & other charges without the 4-5 s wait (archOrderApi.test.mjs)
 *   B2  no board-foot-rates message, and no reman on non-BF items
 * The arithmetic is tested for real; the wiring by source guards, since this repo
 * cannot render the wizard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lineEconomics, PLANING_RATE } from './archOrderPricing.ts';
import { uomLabel } from './archUom.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', p), 'utf8');
const W = src('components/arch/SOWizard.tsx');
const S = src('components/ArchScreen.tsx');
const section = (from, to) => W.slice(W.indexOf(from), W.indexOf(to, W.indexOf(from)));

const line = (o) => Object.assign({ key: 'k', unit: 'BF', preSplitQty: 100, costPerBF: 3, costPerBFUsd: 2.2 }, o);
const noSplit = { on: false, targetBF: '' };
const noReman = { planing: false, planingSpec: '', planingOther: '', cutting: false, cutLength: '' };

test('8b: a USD order is costed at the bundle\'s own receipt-date USD cost', () => {
  const e = lineEconomics(line(), noSplit, noReman, 5, 0.71, undefined, 'USD');
  assert.equal(e.unitCost, 2.2);
  assert.ok(Math.abs(e.lotCost - 220) < 1e-9, e.lotCost);
  assert.ok(Math.abs(e.profit - (500 - 220)) < 1e-9, e.profit);
});

test('8b: without a USD figure, or on another currency, CAD times the order-date rate as before', () => {
  assert.equal(lineEconomics(line({ costPerBFUsd: null }), noSplit, noReman, 5, 0.71, undefined, 'USD').unitCost, 3 * 0.71);
  assert.equal(lineEconomics(line(), noSplit, noReman, 5, 0.65, undefined, 'EUR').unitCost, 3 * 0.65);
  assert.equal(lineEconomics(line(), noSplit, noReman, 5, 1, undefined, undefined).unitCost, 3, 'no conversion: CAD');
});

test('8b: profit is price - lot cost - reman - split, no operations & insurance', () => {
  const r = { ...noReman, planing: true, planingSpec: '13/16' };
  const e = lineEconomics(line({ costPerBFUsd: null }), noSplit, r, 5, 1, undefined, undefined);
  assert.equal(e.opsInsuranceCost, 0);
  assert.equal(e.profit, 500 - 300 - 100 * PLANING_RATE);
});

test('8c: services are reported in CAD, unconverted, while profit subtracts them converted', () => {
  const r = { ...noReman, cutting: true, cutLength: "8'" };
  const e = lineEconomics(line(), noSplit, r, 5, 0.7, { planing: 0.2, cut: 0.2 }, 'USD');
  assert.equal(e.servicesCad, 100 * 0.2);
  assert.ok(Math.abs(e.cuttingCost - 100 * 0.2 * 0.7) < 1e-9);
  assert.ok(Math.abs(e.profit - (500 - 220 - 100 * 0.2 * 0.7)) < 1e-9);
});

test('B2: a non-BF line carries no reman cost', () => {
  const r = { ...noReman, planing: true, planingSpec: '13/16', cutting: true, cutLength: "8'" };
  const e = lineEconomics(line({ unit: 'LF' }), noSplit, r, 5, 1);
  assert.equal(e.servicesCad, 0);
  assert.equal(e.processingCost, 0);
});

test('8a: UOM labels read like NetSuite\'s UOM column', () => {
  assert.deepEqual(['BF', 'LF', 'SQFT', 'UNIT'].map(uomLabel), ['BF', 'LF', 'SQFT', 'Unit']);
});

test('8a/8b: Quantity and UOM in Items, Split, Pricing and Review; no "Lot BF" header left', () => {
  assert.doesNotMatch(W, />Lot BF</);
  assert.doesNotMatch(W, />BF to pick</);
  assert.equal((W.match(/<th style=\{\{ \.\.\.th, textAlign: 'right' \}\}>Quantity<\/th>/g) || []).length, 4);
  assert.equal((W.match(/<th style=\{th\}>UOM<\/th>/g) || []).length, 4);
  assert.equal((W.match(/\{uomLabel\(l\.unit\)\}<\/td>/g) || []).length, 4, 'one UOM cell per table row');
  assert.match(W, /Unit cost \(\{COST_CURRENCY\}\)/, 'Items keeps CAD');
  assert.match(W, /Price \/ Unit \(\{orderCurrency\}\)/, 'Review');
});

test('8b: no operations & insurance box, no Pricing check, legend states the rule', () => {
  const price = section('const priceBody = (', 'const reviewBody');
  assert.doesNotMatch(price, /<ProvisionalNote>/);
  assert.doesNotMatch(W, /Pricing check/);
  assert.doesNotMatch(W, /Operations &amp; insurance/);
  assert.match(W, /Profit = Revenue − Lot cost − Services\./);
  assert.match(W, /each bundle\\u2019s own USD cost at its receipt-date rate, as on the main screen/);
  assert.match(price, /fmtMoney\(e\.unitCost, costFx !== 1 \? orderCurrency : COST_CURRENCY\)/);
});

test('8b: the cart carries the receipt-date USD cost from the same rung as the CAD one', () => {
  assert.match(S, /costPerBFUsd: lot\.costPerUnit === null \|\| lot\.costPerUnit === undefined\s*\? \(row\.avgCostPerUnitUsd \?\? null\)\s*: \(lot\.costPerUnitUsd \?\? null\),/);
});

test('B2: no board-foot-rates message; plane and cut locked on non-BF lines and never sent', () => {
  assert.doesNotMatch(W, /These are <strong>board foot<\/strong> rates/);
  assert.doesNotMatch(W, /no \{l\.unit\} rate/);
  assert.match(W, /checked=\{r\.planing && l\.unit === 'BF'\}/);
  assert.match(W, /checked=\{r\.cutting && l\.unit === 'BF'\}/);
  assert.match(W, /reman: l\.unit === 'BF' \? rm\(l\.key\) : emptyReman\(\),/);
  assert.match(W, /if \(l\.existing \|\| l\.unit !== 'BF'\) return;/, 'apply-to-all skips them');
  assert.match(W, /if \(l\.unit !== 'BF'\) return true;/, 'remanOk ignores them');
});

test('8d: the wizard starts from and reports a draft that ArchScreen keeps in a ref', () => {
  for (const f of ['stepIndex', 'charges', 'customer', 'customerId', 'customerPO', 'currency', 'shipDate',
    'incoterms', 'equipment', 'repTeam', 'split', 'reman', 'price']) {
    assert.match(W, new RegExp('d0 \\? d0\\.' + f + ' :'), f + ' restored');
  }
  assert.match(W, /onDraftChange\?\.\(\{/);
  assert.match(W, /if \(d0 && d0\.customerId\) loadAddressesFor\(d0\.customerId, d0\.shipTo \|\| undefined\);/);
  assert.match(S, /const draftRef = React\.useRef<ArchWizardDraft \| null>\(null\);/);
  assert.match(S, /initialDraft=\{editingSO \? null : draftRef\.current\}/);
  assert.match(S, /onDraftChange=\{editingSO \? undefined : handleDraftChange\}/);
});

test('8d: dropped on success (and frozen until close), on Clear, and on Edit', () => {
  const ok = S.indexOf('if (result.ok) {');
  assert.ok(S.indexOf('draftRef.current = null;', ok) > ok && S.indexOf('draftFrozen.current = true;', ok) > ok);
  assert.match(S, /setCartNote\(null\);\s*draftRef\.current = null;/, 'Clear');
  assert.match(S, /const handleEditOrder = React\.useCallback\(\(soNo: string\) => \{\s*draftRef\.current = null;/);
  assert.match(S, /setWizardKey\(\(k\) => k \+ 1\);\s*draftFrozen\.current = false;/, 'the remount on close stays');
  assert.match(S, /if \(!draftFrozen\.current\) draftRef\.current = d;/);
});

test('B1: ArchScreen warms the endpoint health answer once', () => {
  assert.match(S, /React\.useEffect\(\(\) => \{\s*void fetchWriteAuth\(\);\s*\}, \[\]\);/);
});
