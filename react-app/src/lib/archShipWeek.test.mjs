/**
 * Feedback 13, 2026-09-22. Ship Week is `custbody_ship_week` (MGSL plan with it:
 * set by hand on 259 of 870 MTL and 178 of 503 IND prod orders since August,
 * against 0 and 14 for the ship date), resolved by ONE shared rule. It is a WEEK:
 * 62% of hand-set values are Mondays and 40 of 171 fall before the order date.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dueInfo } from './archSplit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SH = join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared');
const loadMod = (f) => { let ex = null; new Function('define', readFileSync(join(SH, f), 'utf8'))((d, fac) => { ex = fac(); }); return ex; };
const W = loadMod('archShipWeek.js');
const oc = readFileSync(join(SH, 'archOrderCreate.js'), 'utf8');

test('Ship Week wins when it is real', () => {
  assert.deepEqual(W.resolve({ shipWeek: '2026-09-28', shipDate: '2026-09-30', tranDate: '2026-09-22', createdDate: '2026-09-22' }),
    { date: '2026-09-28', source: 'week', defaulted: false });
});

test('SO-ARC-25: default Ship Week, typed ship date -> the ship date', () => {
  assert.deepEqual(W.resolve({ shipWeek: '2026-09-22', shipDate: '2026-09-30', tranDate: '2026-09-22', createdDate: '2026-09-22' }),
    { date: '2026-09-30', source: 'date', defaulted: false });
});

test('the wizard typed one day into BOTH fields: read as a date, late the next day', () => {
  assert.deepEqual(W.resolve({ shipWeek: '2026-09-30', shipDate: '2026-09-30', tranDate: '2026-09-22', createdDate: '2026-09-22' }),
    { date: '2026-09-30', source: 'date', defaulted: false });
});

test('SAP import: Ship Week = import day, ship date = order date -> nothing, flagged', () => {
  assert.deepEqual(W.resolve({ shipWeek: '2026-09-18', shipDate: '2026-09-09', tranDate: '2026-09-09', createdDate: '2026-09-18' }),
    { date: '', source: '', defaulted: true });
});

test('SO-ARC-11: a week BEFORE the order date is real, not a default', () => {
  assert.equal(W.resolve({ shipWeek: '2026-09-20', shipDate: '2026-09-21', tranDate: '2026-09-21', createdDate: '2026-09-21' }).date, '2026-09-20');
});

test('nothing at all is no date and NOT flagged defaulted; M/D/YYYY input is read', () => {
  assert.deepEqual(W.resolve({}), { date: '', source: '', defaulted: false });
  assert.equal(W.resolve({ shipWeek: '9/28/2026', tranDate: '9/22/2026' }).date, '2026-09-28');
});

test('forOrder falls back to the caller dates when the read missed the id', () => {
  assert.equal(W.forOrder({ byId: {} }, 1, { shipDate: '2026-09-30', tranDate: '2026-09-22' }).source, 'date');
  assert.equal(W.forOrder(null, 1, { shipDate: '2026-09-22', tranDate: '2026-09-22' }).defaulted, true);
});

test('dueInfo on a WEEK: inside it ships this week, late only after the week', () => {
  const mon = '2026-09-21';
  assert.equal(dueInfo(mon, 'week', new Date(2026, 8, 23)).label, 'Ships this week');
  assert.equal(dueInfo(mon, 'week', new Date(2026, 8, 27)).label, 'Ships this week');
  assert.equal(dueInfo(mon, 'week', new Date(2026, 8, 29)).label, '2d late');
  assert.equal(dueInfo(mon, 'week', new Date(2026, 8, 14)).label, 'Ships in 7d');
  // a real ship DATE keeps the exact-day reading
  assert.equal(dueInfo(mon, 'date', new Date(2026, 8, 23)).label, '2d late');
});

test('the endpoint writes the typed date to Ship Week too, on create AND append, only when typed', () => {
  assert.match(oc, /const H_SHIP_WEEK   = 'custbody_ship_week';/);
  assert.equal((oc.match(/setIfPresent\(so, H_SHIP_WEEK, d, 'the ship week'\);/g) || []).length, 2);
  // both writes sit inside `if (h.shipDate)`, so an empty preload never blanks a week
  const blocks = oc.split('if (h.shipDate) {').slice(1).map((b) => b.split('\n            }\n')[0]);
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((b) => /H_SHIP_WEEK/.test(b)));
});

test('the three server consumers use the shared module, and none reinvents the rule', () => {
  const root = join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen');
  const mr = readFileSync(join(root, 'entry_points/mr/mcgi_mr_trader_screen_cache_arch.js'), 'utf8');
  const svc = readFileSync(join(root, 'service/trader_screen_service_arch.js'), 'utf8');
  const q = readFileSync(join(SH, 'archSplitQueue.js'), 'utf8');
  for (const [name, src] of [['mr', mr], ['service', svc], ['queue', q]]) {
    assert.match(src, /ArchShipWeek\.readShipWeeks\(/, name);
    assert.match(src, /ArchShipWeek\.forOrder\(/, name);
  }
  assert.doesNotMatch(q, /r\.shipdate !== r\.trandate/);
});

test('an append that keeps the preloaded ship date does not send it back (final review)', () => {
  const wiz = readFileSync(join(here, '../components/arch/SOWizard.tsx'), 'utf8');
  const api = readFileSync(join(here, './archOrderApi.ts'), 'utf8');
  assert.match(wiz, /setShipDate\(preShip\);\s*setPreloadedShipDate\(preShip\);/);
  assert.match(wiz, /shipDateChanged: mode === 'existing' \? shipDate !== preloadedShipDate : true,/);
  assert.match(api, /shipDate: draft\.header\.shipDateChanged === false \? undefined : \(draft\.header\.shipDate \|\| undefined\),/);
});
