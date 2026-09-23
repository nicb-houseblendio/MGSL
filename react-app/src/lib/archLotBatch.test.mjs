/**
 * 2026-09-23: the ARCH cache reads receipt facts, PO seals and lot costs ONCE per
 * run (costs once per location) instead of once per item x location pair.
 *
 * Runs the SHIPPED builder's getInputData, reduce and summarize with faked
 * NetSuite modules. LotCostLib is faked to answer per (lot, location), so a pair
 * given another location's figure, or a batch that loses a lot, shows up here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TS = join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen');
const SHARED = join(TS, 'shared');
const MR = join(TS, 'entry_points', 'mr', 'mcgi_mr_trader_screen_cache_arch.js');
const load = (file, resolve, edit) => {
  let mod = null;
  const text = readFileSync(file, 'utf8');
  new Function('define', edit ? edit(text) : text)((deps, f) => { mod = f(...deps.map(resolve)); });
  return mod;
};
// The shipped builder has the shadow check OFF; one test turns it on in memory.
const shadowOn = (t) => {
  if (!t.includes('const LOT_BATCH_SHADOW = false;')) throw new Error('shadow flag not found');
  return t.replace('const LOT_BATCH_SHADOW = false;', 'const LOT_BATCH_SHADOW = true;');
};
const noDeps = () => { throw new Error('no deps'); };
const CacheKeys = load(join(SHARED, 'cacheKeys_arch.js'), noDeps);

// Lot 900 sits at BOTH locations; each location costs it differently.
const lotRow = (o) => Object.assign({ itemid: '3198', itemcode: 'SHE44KD', description: 'Shedua 4/4 KD', species: 'SHE',
  category: 'Lumber', thickness: '4/4', unitname: 'BF', rate: '0.001', locationid: '151', locationname: 'Prevost (PBF)',
  lotid: '900', lotno: '315310-1', storedqty: '0.5' }, o);
const LOTS = [
  lotRow({}),
  lotRow({ lotid: '901', lotno: '315310-2' }),
  lotRow({ locationid: '150', locationname: 'Morgan.', lotid: '900', lotno: '315310-1', storedqty: '0.2' }),
  lotRow({ locationid: '150', locationname: 'Morgan.', lotid: '902', lotno: '315310-3' }),
];
const COST = { '900@151': 2.5, '901@151': 3, '900@150': 4, '902@150': 5 };

const runAll = (opt = {}) => {
  const store = {};
  const costCalls = [];
  const audits = [];
  const errors = [];
  const queryFake = {
    runSuiteQL: ({ query: sql, params }) => {
      let rows = [];
      if (/FROM inventorynumberlocation/.test(sql)) rows = LOTS;
      else if (/custbody4/.test(sql) && /InvAdjst/.test(sql)) {
        if (opt.factsThrowBatch && (params || []).length > 4) throw new Error('facts batch down');
        rows = (params || []).slice(2).map((id) => ({ lotid: id, lotdt: '2026-09-01', vessel: 'V' + id, fxrec: '0.73', fxtran: '0.7' }));
      } else if (/custbody_seal_trailer_number/.test(sql) && /FROM inventoryassignment/.test(sql)) {
        rows = (params || []).filter((id) => id === '902').map((id) => ({ lotid: id, seal: 'SEAL' + id }));
      }
      return { asMappedResults: () => rows };
    },
  };
  const LotCostFake = {
    getLotCostsAtLocation: (ids, loc) => {
      costCalls.push([loc, ids.slice()]);
      if (opt.costThrowAt === String(loc) && ids.length > 1) throw new Error('cost batch down at ' + loc);
      const out = {};
      ids.forEach((id) => { out[id] = COST[id + '@' + loc] ?? null; });
      return out;
    },
  };
  const cache = {
    get: ({ key }) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    put: ({ key, value }) => { store[key] = value; },
    remove: ({ key }) => { delete store[key]; },
  };
  const logFake = {
    audit: (t, d) => audits.push([typeof t === 'object' ? t.title : t, typeof t === 'object' ? t.details : d]),
    error: (t, d) => errors.push([typeof t === 'object' ? t.title : t, typeof t === 'object' ? t.details : d]),
    debug: () => {},
  };
  const mod = load(MR, (id) => {
    if (id === 'N/query') return queryFake;
    if (id === 'N/search') return { create: () => ({ run: () => ({ each: () => {} }) }), createColumn: (o) => o, createFilter: (o) => o };
    if (id === 'N/log') return logFake;
    if (id === 'N/runtime') return { getCurrentScript: () => ({ id: 'x', deploymentId: 'y', logLevel: 'AUDIT', getParameter: () => null }) };
    if (id === 'N/task') return { TaskType: { MAP_REDUCE: 'M' }, create: () => ({ submit: () => 't' }) };
    if (/cacheKeys_arch$/.test(id)) return CacheKeys;
    if (/cacheClient$/.test(id)) return { getCache: () => cache };
    if (/MCGI_LIB_LotCost$/.test(id)) return LotCostFake;
    if (/archSalesTeam$/.test(id)) return { readTeams: () => ({}), loadTeams: () => ({}) };
    if (/archShipWeek$/.test(id)) return load(join(SHARED, 'archShipWeek.js'), noDeps);
    if (/archReservation$/.test(id)) return load(join(SHARED, 'archReservation.js'), noDeps);
    if (/archRebuildGate$/.test(id)) return load(join(SHARED, 'archRebuildGate.js'), noDeps);
    throw new Error('unmocked module: ' + id);
  }, opt.shadow ? shadowOn : null);
  const input = mod.getInputData();
  const batchedCalls = costCalls.length;
  const written = [];
  Object.keys(input).forEach((k) => {
    mod.reduce({ key: k, values: [input[k]], write: (o) => written.push(o.value) });
  });
  const it = () => ({ each: () => {} });
  mod.summarize({
    output: { iterator: () => ({ each: (fn) => written.forEach((v, i) => fn('k' + i, v)) }) },
    mapSummary: { errors: { iterator: it } }, reduceSummary: { errors: { iterator: it } }, inputSummary: {},
  });
  const rows = written.map((v) => JSON.parse(v));
  const pairs = Object.keys(input).map((k) => JSON.parse(input[k]));
  return { input, pairs, rows, costCalls, batchedCalls, audits, errors, store };
};

test('batch: one cost call per location, each pair gets ITS location\'s figures', () => {
  const r = runAll();
  assert.equal(r.batchedCalls, 2, 'getInputData: one call per location, not per pair');
  const byLoc = Object.fromEntries(r.pairs.map((p) => [p.locationId, p.batchCosts]));
  assert.deepEqual(byLoc['151'], { 900: 2.5, 901: 3 });
  assert.deepEqual(byLoc['150'], { 900: 4, 902: 5 }, 'lot 900 carries Morgan\'s cost at Morgan');
  const seals = Object.fromEntries(r.pairs.map((p) => [p.locationId, p.batchSeals]));
  assert.deepEqual(seals['150'], { 902: 'SEAL902' });
  assert.deepEqual(seals['151'], {});
});

test('batch: the shadow check compares every lot and finds 0 mismatches, then is stripped', () => {
  const r = runAll({ shadow: true });
  const line = r.audits.find((a) => a[0] === 'ARCH cache lot batch shadow check');
  assert.ok(line, 'one shadow line per rebuild');
  assert.match(line[1], /^\d+ lot value\(s\) compared, 0 mismatch\(es\)$/);
  assert.equal(r.errors.filter((e) => /shadow/.test(e[0])).length, 0);
  const cached = r.store[CacheKeys.SUMMARY] || '';
  assert.ok(cached && !cached.includes('_shadow'), 'never reaches the cached payload');
});

test('batch: a failed batch falls back to per-pair reads, same answers', () => {
  const r = runAll({ costThrowAt: '151', factsThrowBatch: true, shadow: true });
  const p151 = r.pairs.find((p) => p.locationId === '151');
  assert.equal(p151.batchCosts, undefined, 'no slice for the failed location');
  assert.equal(p151.batchFacts, undefined, 'no facts slice when the facts batch failed');
  const line = r.audits.find((a) => a[0] === 'ARCH cache lot data batched');
  assert.match(line[1], /FELL BACK to per-pair reads for: receipt facts: facts batch down \| costs at 151: cost batch down at 151/);
  // The rows still carry costs: reduce read them per pair (single-lot calls succeed in the fake).
  assert.ok(r.costCalls.length > r.batchedCalls, 'per-pair calls happened in reduce');
});

test('batch, shadow OFF (as shipped): one cost read per location and none per pair', () => {
  const r = runAll();
  assert.equal(r.costCalls.length, 2, 'the two batched calls, no per-pair call in reduce');
  assert.equal(r.audits.filter((a) => a[0] === 'ARCH cache lot batch shadow check').length, 0);
  assert.match(r.audits.find((a) => a[0] === 'ARCH cache lot data batched')[1], /\(facts \d+, seals \d+, costs \d+\)/);
});
