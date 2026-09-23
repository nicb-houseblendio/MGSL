/**
 * The change-driven rebuild gate (2026-09-23): the ARCH cache rebuilds soon
 * after an ARC change instead of every 15 minutes.
 *
 * Two layers, both the SHIPPED source:
 *   1. shared/archRebuildGate.js, the pure rule;
 *   2. the cache MR's getInputData and summarize with faked cache and query,
 *      for the properties that make it safe: silent and query-free on the paced
 *      path, the throttle read back before any query, a failing detector reported
 *      once and never a loop, DEBUG pinning it to the backstop, and failures
 *      backing early reruns off.
 *
 * What the fakes stand for was MEASURED under N/query on 2026-09-23 (temp probe
 * 6522, action gateSql): every signature query ran, 53 ms in total;
 * lastmodifieddate reads on the CURRENT_DATE clock (ET) and deleteddate on the
 * SYSDATE clock (PT), which is why deletions are signed on their own clock.
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

const load = (file, resolve) => {
  let mod = null;
  new Function('define', readFileSync(file, 'utf8'))((deps, f) => { mod = f(...deps.map(resolve)); });
  return mod;
};
const noDeps = () => { throw new Error('no deps expected'); };
const Gate = load(join(SHARED, 'archRebuildGate.js'), noDeps);
const Reservation = load(join(SHARED, 'archReservation.js'), noDeps);
const CacheKeys = load(join(SHARED, 'cacheKeys_arch.js'), noDeps);

const MIN = 60 * 1000;
const NOW = 1e12;

/* ══ 1. The rule ═════════════════════════════════════════════════════════ */

test('decide: floor, backstop, DEBUG, backoff, cap, throttle', () => {
  const d = (s) => Gate.decide(Object.assign({ now: NOW, debug: false, state: {} }, s));
  assert.equal(d({ lastStart: 0 }).go, 'run', 'no pacing stamp fails open');
  assert.equal(d({ lastStart: NOW + MIN }).go, 'run', 'a stamp in the future fails open');
  assert.equal(d({ lastStart: NOW - 30 * 1000 }).go, 'skip', 'inside the 60 s floor');
  assert.equal(d({ lastStart: NOW - 5 * MIN }).go, 'detect');
  assert.match(d({ lastStart: NOW - 15 * MIN }).reason, /^backstop/);
  assert.equal(d({ lastStart: NOW - 5 * MIN, debug: true }).go, 'skip', 'DEBUG stays on the backstop');
  assert.equal(d({ lastStart: NOW - 15 * MIN, debug: true }).go, 'run', 'but the backstop still runs at DEBUG');
  assert.equal(d({ lastStart: NOW - 3 * MIN, state: { fails: 2 } }).go, 'skip', '2 fails: 4 min backoff');
  assert.equal(d({ lastStart: NOW - 5 * MIN, state: { fails: 2 } }).go, 'detect');
  assert.equal(d({ lastStart: NOW - 14 * MIN, state: { fails: 9 } }).go, 'skip', 'many fails: backstop only');
  const starts = Array.from({ length: 15 }, (_, i) => NOW - (i + 2) * MIN);
  assert.equal(d({ lastStart: NOW - 2 * MIN, state: { starts } }).go, 'skip', 'hourly cap of 15');
  const old = Array.from({ length: 15 }, (_, i) => NOW - (61 + i) * MIN);
  assert.equal(d({ lastStart: NOW - 2 * MIN, state: { starts: old } }).go, 'detect', 'starts older than an hour do not count');
  assert.equal(d({ lastStart: NOW - 5 * MIN, state: { checkAt: NOW - 20 * 1000 } }).go, 'skip', 'checked 20 s ago');
  // Review L1: a lost stamp still fails open, but the gate's own starts are a floor.
  assert.equal(d({ lastStart: 0, state: { starts: [NOW - 20 * 1000] } }).go, 'skip', 'lost stamp, started 20 s ago');
  assert.equal(d({ lastStart: 0, state: { starts: [NOW - 2 * MIN] } }).go, 'run', 'lost stamp, started 2 min ago');
});

test('onSignature: only a STORED signature can call something a change', () => {
  assert.deepEqual(Gate.onSignature({}, 'a'), { go: 'skip', reason: 'seeded' });
  assert.equal(Gate.onSignature({ sig: 'a' }, 'b').go, 'run');
  assert.equal(Gate.onSignature({ sig: 'a' }, 'a').go, 'skip');
});

test('minusMinutes: wall-clock arithmetic, rollovers, junk', () => {
  assert.equal(Gate.minusMinutes('2026-09-23 11:05:11', 5), '2026-09-23 11:00:11');
  assert.equal(Gate.minusMinutes('2026-10-01 00:02:00', 5), '2026-09-30 23:57:00');
  assert.equal(Gate.minusMinutes('2027-01-01 00:00:00', 1440), '2026-12-31 00:00:00');
  assert.equal(Gate.minusMinutes('', 5), '');
  assert.equal(Gate.minusMinutes('9/23/2026 11:05', 5), '');
});

const fakeDb = (over = {}) => {
  const v = Object.assign({
    txn: { n: 11, mx: '2026-09-23 11:05:11', h: 5518440172 },
    arch_res: { n: 0, s: null, mx: null },
    hold: { n: 0, s: null, mx: null },
    capture: { n: 2, s: 402, mx: '2026-09-15 02:19:35' },
    mirror: { n: 0, s: null, e: null, l: null },
    deleted: { mx: '2026-09-23 08:08:56' },
    seed: { mx: '2026-09-23 11:05:11' },
  }, over);
  const log = [];
  const run = (sql, params) => {
    log.push({ sql, params });
    if (v.throwOn && sql.includes(v.throwOn)) throw new Error('Invalid search: ' + v.throwOn);
    if (/DDHH24MISS/.test(sql)) return [v.txn];
    if (/SYSDATE - 2/.test(sql)) return [v.seed];
    if (/FROM customrecord_arch_res/.test(sql)) return [v.arch_res];
    if (/FROM customrecord_mgsl_inventory_hold/.test(sql)) return [v.hold];
    if (/FROM customrecord_msl_plc_capture/.test(sql)) return [v.capture];
    if (/custitemnumber_arch_res_exception IS NOT NULL/.test(sql)) return [v.mirror];
    if (/FROM deletedrecord/.test(sql)) return [v.deleted];
    if (/CURRENT_DATE/.test(sql)) return [{ cd: '2026-09-23 11:17:23' }];
    return [];
  };
  return { run, log, v };
};

test('readSignature: every part moves the signature, the anchor is the only bind', () => {
  const base = Gate.readSignature(fakeDb().run, '2026-09-23 11:00:11');
  assert.equal(base.mx, '2026-09-23 11:05:11');
  const variants = [
    { txn: { n: 12, mx: '2026-09-23 11:05:11', h: 5518440172 } },           // a late commit
    { txn: { n: 11, mx: '2026-09-23 11:05:11', h: 1 } },                    // a second edit
    { arch_res: { n: 1, s: 22, mx: '2026-09-23 11:20:00' } },               // a claim
    { hold: { n: 1, s: 5, mx: '2026-09-23 11:20:00' } },                    // a hold
    { mirror: { n: 1, s: 53089, e: 3, l: 0 } },                             // an exception badge
    { deleted: { mx: '2026-09-23 08:30:00' } },                             // a deletion
  ];
  variants.forEach((o, i) => assert.notEqual(Gate.readSignature(fakeDb(o).run, '2026-09-23 11:00:11').sig, base.sig, 'variant ' + i));
  const db = fakeDb();
  Gate.readSignature(db.run, 'A');
  assert.deepEqual(db.log.filter((x) => x.params.length).map((x) => x.params), [['A']], 'only the transaction window binds the anchor');
  assert.throws(() => Gate.readSignature(fakeDb({ throwOn: 'deletedrecord' }).run, 'A'), /deletedrecord/, 'deletions are strict');
  assert.throws(() => Gate.readSignature(fakeDb({ throwOn: 'DDHH24MISS' }).run, 'A'), /DDHH24MISS/, 'the transaction window is strict');
  // Review M1: prod has no customrecord_arch_res until X.2. A missing table signs
  // as 'x', stably, so the check keeps working on everything else.
  const noClaims = Gate.readSignature(fakeDb({ throwOn: 'FROM customrecord_arch_res' }).run, 'A');
  assert.match(noClaims.sig, /arch_res:x/);
  assert.equal(Gate.readSignature(fakeDb({ throwOn: 'FROM customrecord_arch_res' }).run, 'A').sig, noClaims.sig, 'stable');
  const noMirror = Gate.readSignature(fakeDb({ throwOn: 'custitemnumber_arch_res_exception IS NOT NULL' }).run, 'A');
  assert.match(noMirror.sig, /mirror:x/);
});

test('startedState / finishedState', () => {
  const st = Gate.startedState({ starts: [NOW - 90 * MIN, NOW - 10 * MIN], fails: 2 }, NOW, 'sig', 'anc');
  assert.deepEqual(st.starts, [NOW - 10 * MIN, NOW]);
  assert.equal(st.running, NOW);
  assert.equal(st.sig, 'sig');
  assert.equal(st.anchor, 'anc');
  assert.equal(Gate.finishedState(st, true).fails, 3);
  assert.equal(Gate.finishedState(st, false).fails, 0);
  assert.equal(Gate.finishedState(st, false).running, 0);
});

/* ══ 2. The cache MR ═════════════════════════════════════════════════════ */

const harness = (opt = {}) => {
  const store = Object.assign({}, opt.store || {});
  const db = fakeDb(opt.db || {});
  const audits = [];
  const sqlLog = [];
  const cache = {
    get: ({ key }) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    put: ({ key, value }) => { if (!(opt.unwritable || []).includes(key)) store[key] = value; },
    remove: ({ key }) => { delete store[key]; },
  };
  const queryFake = {
    runSuiteQL: ({ query: sql, params }) => {
      sqlLog.push(sql);
      return { asMappedResults: () => db.run(sql, params || []) };
    },
  };
  const logFake = {
    audit: (t, d) => audits.push([typeof t === 'object' ? t.title : t, typeof t === 'object' ? t.details : d]),
    error: () => {},
    debug: () => {},
  };
  const mod = load(MR, (id) => {
    if (id === 'N/query') return queryFake;
    if (id === 'N/search') return { create: () => ({ run: () => ({ each: () => {} }) }), createColumn: (o) => o, createFilter: (o) => o };
    if (id === 'N/log') return logFake;
    if (id === 'N/runtime') return { getCurrentScript: () => ({ id: 'customscript_x', deploymentId: 'customdeploy_x', logLevel: opt.logLevel || 'AUDIT', getParameter: () => null }) };
    if (id === 'N/task') return { TaskType: { MAP_REDUCE: 'MAP_REDUCE' }, create: () => ({ submit: () => 'x' }) };
    if (/cacheKeys_arch$/.test(id)) return CacheKeys;
    if (/cacheClient$/.test(id)) return { getCache: () => cache };
    if (/MCGI_LIB_LotCost$/.test(id)) return { getLotCostsAtLocation: () => ({}) };
    if (/archSalesTeam$/.test(id)) return { readTeams: () => ({}) };
    if (/archShipWeek$/.test(id)) return load(join(SHARED, 'archShipWeek.js'), noDeps);
    if (/archReservation$/.test(id)) return Reservation;
    if (/archRebuildGate$/.test(id)) return Gate;
    throw new Error('unmocked module: ' + id);
  });
  const realNow = Date.now;
  Date.now = () => opt.now || NOW;
  const out = {};
  try {
    if (opt.summarize) {
      const it = () => ({ each: () => {} });
      const rowsIt = () => ({ each: (fn) => { (opt.rows || []).forEach((r, i) => fn('k' + i, JSON.stringify(r))); } });
      mod.summarize({ output: { iterator: rowsIt }, mapSummary: { errors: { iterator: it } }, reduceSummary: { errors: { iterator: it } },
        inputSummary: opt.inputError ? { error: 'boom' } : {} });
    } else {
      try { out.input = mod.getInputData(); } catch (e) { out.threw = e; }
    }
  } finally { Date.now = realNow; }
  const gate = store[CacheKeys.GATE] ? JSON.parse(store[CacheKeys.GATE]) : null;
  const rebuilt = sqlLog.some((s) => /AS itemcode/.test(s));
  const gateSqls = sqlLog.filter((s) => /DDHH24MISS|SYSDATE - 2|deletedrecord|customrecord_|custitemnumber_arch_res_exception IS NOT NULL|CURRENT_DATE/.test(s));
  return Object.assign(out, { store, gate, audits, sqlLog, rebuilt, gateSqls });
};
const seededState = (o) => JSON.stringify(Object.assign({
  anchor: '2026-09-23 11:00:11',
  sig: Gate.readSignature(fakeDb().run, '2026-09-23 11:00:11').sig,
  starts: [NOW - 5 * MIN], checkAt: NOW - 5 * MIN, fails: 0, running: 0,
}, o || {}));
const stamp = (ago) => String(NOW - ago);

test('M1 inside the floor: no query at all, no rebuild, silent', () => {
  const r = harness({ store: { [CacheKeys.PACE_LAST_START]: stamp(30 * 1000), [CacheKeys.GATE]: seededState() } });
  assert.deepEqual(r.input, {});
  assert.equal(r.sqlLog.length, 0);
  assert.equal(r.audits.length, 0);
});

test('M2 nothing changed: one signature read, no rebuild, silent', () => {
  const r = harness({ store: { [CacheKeys.PACE_LAST_START]: stamp(5 * MIN), [CacheKeys.GATE]: seededState() } });
  assert.deepEqual(r.input, {});
  assert.equal(r.rebuilt, false);
  assert.ok(r.gateSqls.length > 0 && r.gateSqls.length <= 6, 'one signature: ' + r.gateSqls.length + ' queries');
  assert.equal(r.gate.checkAt, NOW, 'throttle stamped');
  assert.equal(r.audits.length, 0);
});

test('M3 a change: rebuild now, stamped, reason logged, anchor moved to the change', () => {
  const r = harness({ store: { [CacheKeys.PACE_LAST_START]: stamp(5 * MIN), [CacheKeys.GATE]: seededState() },
    db: { txn: { n: 12, mx: '2026-09-23 11:30:00', h: 7 } } });
  assert.equal(r.rebuilt, true);
  assert.equal(r.store[CacheKeys.PACE_LAST_START], String(NOW));
  assert.deepEqual(r.audits.find((a) => a[0] === 'ARCH cache rebuild'), ['ARCH cache rebuild', 'change detected']);
  assert.equal(r.gate.anchor, '2026-09-23 11:25:00', 'newest change minus 5 min');
  assert.equal(r.gate.running, NOW);
  assert.deepEqual(r.gate.starts, [NOW - 5 * MIN, NOW]);
  assert.ok(r.gate.sig && r.gate.sig !== JSON.parse(seededState()).sig, 'the new baseline is stored');
});

test('M4 a failing detector: no rebuild, reported once, then silent', () => {
  const opt = { store: { [CacheKeys.PACE_LAST_START]: stamp(5 * MIN), [CacheKeys.GATE]: seededState() },
    db: { throwOn: 'deletedrecord' } };
  const r = harness(opt);
  assert.equal(r.rebuilt, false);
  assert.equal(r.audits.filter((a) => /change check failed/.test(a[0])).length, 1);
  const again = harness(Object.assign({}, opt, { store: r.store, now: NOW + 2 * MIN }));
  assert.equal(again.rebuilt, false);
  assert.equal(again.audits.length, 0, 'same message, silent');
});

test('M5 DEBUG log level: no detector, backstop only', () => {
  const r = harness({ logLevel: 'DEBUG', store: { [CacheKeys.PACE_LAST_START]: stamp(5 * MIN), [CacheKeys.GATE]: seededState() },
    db: { txn: { n: 99, mx: '2026-09-23 11:30:00', h: 7 } } });
  assert.equal(r.gateSqls.length, 0);
  assert.equal(r.rebuilt, false);
});

test('M6 an unwritable gate key: skip, never a detector every cycle', () => {
  const r = harness({ unwritable: [CacheKeys.GATE],
    store: { [CacheKeys.PACE_LAST_START]: stamp(5 * MIN), [CacheKeys.GATE]: seededState({ checkAt: NOW - 5 * MIN }) } });
  assert.equal(r.gateSqls.length, 0);
  assert.equal(r.rebuilt, false);
});

test('M7 no stored anchor: seed, no rebuild', () => {
  const r = harness({ store: { [CacheKeys.PACE_LAST_START]: stamp(5 * MIN) } });
  assert.equal(r.rebuilt, false);
  assert.equal(r.gate.anchor, '2026-09-23 11:00:11');
  assert.ok(r.gate.sig.startsWith('t:'));
});

test('M8 no pacing stamp: fails open and rebuilds, whatever the gate says', () => {
  const r = harness({ store: { [CacheKeys.GATE]: seededState({ fails: 9 }) } });
  assert.equal(r.rebuilt, true);
  assert.match(r.audits.find((a) => a[0] === 'ARCH cache rebuild')[1], /no pacing stamp/);
});

const ROW = { itemCode: 'PUR44KD', locationName: 'Prevost (PBF)', lots: [], avgCostPerUnit: null, avgCostPerUnitUsd: null };

test('M9 summarize: a failed real run counts, a good one clears, a paced one leaves it', () => {
  const running = seededState({ running: NOW - MIN, fails: 1 });
  const failed = harness({ summarize: true, inputError: true, store: { [CacheKeys.GATE]: running } });
  assert.equal(failed.gate.fails, 2);
  assert.equal(failed.gate.running, 0);
  const good = harness({ summarize: true, rows: [ROW], store: { [CacheKeys.GATE]: running } });
  assert.equal(good.gate.fails, 0);
  const paced = harness({ summarize: true, store: { [CacheKeys.GATE]: seededState({ running: 0, fails: 3 }) } });
  assert.equal(paced.gate.fails, 3, 'a paced cycle is not a run');
  // Review L5: a run aborted before its summarize is NOT cleared by an idle cycle.
  const idleAfterAbort = harness({ summarize: true, store: { [CacheKeys.GATE]: running } });
  assert.equal(idleAfterAbort.gate.fails, 1);
  assert.equal(idleAfterAbort.gate.running, NOW - MIN);
});

test('M10 a shrink-guard refusal backs early reruns off like a failure (review M4)', () => {
  const cached = JSON.stringify(Array.from({ length: 20 }, (_, i) => Object.assign({}, ROW, { itemCode: 'I' + i })));
  const r = harness({ summarize: true, rows: [ROW],
    store: { [CacheKeys.GATE]: seededState({ running: NOW - MIN, fails: 0 }), [CacheKeys.SUMMARY]: cached } });
  assert.ok(r.audits.length >= 0);
  assert.equal(r.gate.fails, 1, 'refused 20 -> 1 row, counted');
});
