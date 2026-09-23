/**
 * Feedback 8: the ARCH cache chain starts the reservation reconciler.
 *
 * Why this exists: the reconciler shipped 2026-09-23 on a native recurrence
 * (daily, repeat 15 min) that never fired, status SCHEDULED, zero runs. It is
 * NOTSCHEDULED now and the cache chain, proven alive since August, submits it
 * from summarize's `finally`, after its own reschedule.
 *
 * Two layers, both the SHIPPED source:
 *   1. archReservation.reconKickDecision, the rule of when;
 *   2. the cache MR's summarize, run with faked cache, task and query, for the
 *      safety properties: the chain's own reschedule always goes first and is
 *      never affected, the throttle is read back before any query, a busy
 *      refusal consumes nothing, a failure is reported once.
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
const Reservation = load(join(SHARED, 'archReservation.js'), noDeps);
const CacheKeys = load(join(SHARED, 'cacheKeys_arch.js'), noDeps);

const MIN = 60 * 1000;
const OWN_SCRIPT = 'customscript_mcgi_mr_trader_screen_cache_arch';
const OWN_DEPLOY = 'customdeploy_mcgi_mr_trader_screen_cache_arch';
const RECON_DEPLOY = 'customdeploy_mcgi_mr_arch_reservation';

/* ══ 1. The rule ═════════════════════════════════════════════════════════ */

test('decision: when the chain submits the reconciler', () => {
  const d = (s) => Reservation.reconKickDecision(Object.assign({ now: 1e12, submitAt: 0, newArcReceipt: false }, s));
  assert.equal(d({ claims: 0 }).submit, true, 'never submitted: the hourly sweep is due');
  assert.equal(d({ claims: 0 }).reason, 'hourly sweep');
  assert.equal(d({ claims: 0, submitAt: 1e12 - 30 * MIN }).submit, false, 'no claims, 30 min: nothing to do');
  assert.equal(d({ claims: 0, submitAt: 1e12 - 61 * MIN }).submit, true, 'no claims, over an hour: sweep');
  assert.equal(d({ claims: 2, submitAt: 1e12 - 5 * MIN }).submit, false, 'claims, 5 min, no receipt: wait');
  assert.equal(d({ claims: 2, submitAt: 1e12 - 5 * MIN, newArcReceipt: true }).reason, 'an ARC item receipt was saved');
  assert.equal(d({ claims: 2, submitAt: 1e12 - 15 * MIN }).submit, true, 'claims, 15 min: backstop');
  assert.equal(d({ claims: 2, submitAt: 1e12 - 30 * 1000, newArcReceipt: true }).submit, false,
    'even a receipt waits out the one-minute throttle');
  assert.equal(d({ claims: null, submitAt: 0 }).submit, false, 'claims unreadable: never submit');
  assert.equal(d({ claims: 2, submitAt: 1e12 + 5 * MIN }).submit, true, 'a stamp in the future counts as long ago');
});

test('decision: busy refusals are recognised by name or message', () => {
  assert.equal(Reservation.isSubmitBusy({ name: 'MAP_REDUCE_ALREADY_RUNNING' }), true);
  assert.equal(Reservation.isSubmitBusy({ name: 'SSS_ERROR', message: 'FAILED_TO_SUBMIT_JOB_REQUEST_1: queued' }), true);
  assert.equal(Reservation.isSubmitBusy({ name: 'SSS_INVALID_SCRIPTLET_ID' }), false);
  assert.equal(Reservation.isSubmitBusy(null), false);
});

/* ══ 2. The cache MR's summarize ═════════════════════════════════════════ */

const run = (opt = {}) => {
  const store = Object.assign({}, opt.store || {});
  const submits = [];
  const audits = [];
  const errors = [];
  const sqlLog = [];
  const cache = {
    get: ({ key }) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    put: ({ key, value }) => { if (!(opt.unwritable || []).includes(key)) store[key] = value; },
    remove: ({ key }) => { delete store[key]; },
  };
  const queryFake = {
    runSuiteQL: ({ query: sql }) => {
      sqlLog.push(sql);
      if (opt.queryThrows) throw new Error('query down');
      let rows = [];
      if (/FROM customrecord_arch_res/.test(sql)) {
        if (opt.claims == null) throw new Error('Invalid search type: customrecord_arch_res');
        rows = [{ n: String(opt.claims) }];
      } else if (/MAX\(id\)/.test(sql) && /ItemRcpt/.test(sql)) rows = [{ mx: opt.rcptMax == null ? null : String(opt.rcptMax) }];
      else if (/EXISTS/.test(sql) && /ItemRcpt/.test(sql)) rows = [{ n: String(opt.arcCount || 0) }];
      return { asMappedResults: () => rows };
    },
  };
  const taskFake = {
    TaskType: { MAP_REDUCE: 'MAP_REDUCE' },
    create: (o) => ({
      submit: () => {
        if (o.deploymentId === RECON_DEPLOY && opt.submitError) {
          const e = new Error(opt.submitError.message || 'refused');
          e.name = opt.submitError.name;
          throw e;
        }
        submits.push(o.deploymentId);
        return 'task-1';
      },
    }),
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
    if (id === 'N/runtime') return { getCurrentScript: () => ({ id: OWN_SCRIPT, deploymentId: OWN_DEPLOY, getParameter: () => null }) };
    if (id === 'N/task') return taskFake;
    if (/cacheKeys_arch$/.test(id)) return CacheKeys;
    if (/cacheClient$/.test(id)) return { getCache: () => cache };
    if (/MCGI_LIB_LotCost$/.test(id)) return { getLotCostsAtLocation: () => ({}) };
    if (/archSalesTeam$/.test(id)) return {};
    if (/archShipWeek$/.test(id)) return load(join(SHARED, 'archShipWeek.js'), noDeps);
    if (/archReservation$/.test(id)) return Reservation;
    if (/archRebuildGate$/.test(id)) return load(join(SHARED, 'archRebuildGate.js'), noDeps);
    throw new Error('unmocked module: ' + id);
  });
  const it = () => ({ each: () => {} });
  const ctx = { output: { iterator: it }, mapSummary: { errors: { iterator: it } }, reduceSummary: { errors: { iterator: it } }, inputSummary: {} };
  const realNow = Date.now;
  Date.now = () => opt.now || 1e12;
  try { mod.summarize(ctx); } finally { Date.now = realNow; }
  return { store, submits, audits, errors, sqlLog };
};
const recon = (r) => r.submits.filter((d) => d === RECON_DEPLOY).length;
const kickSql = (r) => r.sqlLog.filter((s) => /customrecord_arch_res|ItemRcpt/.test(s));
const kickAudits = (r) => r.audits.filter((a) => /reservation reconciler/.test(a[0]));

test('K1 the chain reschedules itself FIRST, and a broken kick cannot touch it', () => {
  const r = run({ queryThrows: true, submitError: { name: 'SSS_INVALID_SCRIPTLET_ID' }, claims: 0 });
  assert.equal(r.submits[0], OWN_DEPLOY, 'own reschedule is the first submit');
  assert.equal(r.submits.filter((d) => d === OWN_DEPLOY).length, 1, 'and exactly one, never a second member');
  assert.equal(r.errors.filter((e) => /SELF-RESCHEDULE FAILED/.test(e[0])).length, 0);
});

test('K2 first check with no claims: one hourly sweep, stamped, one AUDIT line', () => {
  const r = run({ claims: 0 });
  assert.equal(recon(r), 1);
  assert.equal(r.store[CacheKeys.RECON_SUBMIT_AT], String(1e12));
  assert.equal(kickAudits(r).length, 1);
  assert.match(kickAudits(r)[0][1], /hourly sweep, 0 claim/);
  assert.equal(kickSql(r).some((s) => /ItemRcpt/.test(s)), false, 'no receipt query without claims');
});

test('K3 inside the one-minute throttle: no query at all, silent', () => {
  const r = run({ claims: 3, store: { [CacheKeys.RECON_CHECK_AT]: String(1e12 - 20 * 1000) } });
  assert.equal(kickSql(r).length, 0);
  assert.equal(recon(r), 0);
  assert.equal(kickAudits(r).length, 0);
});

test('K4 an unwritable throttle means skip, never a query every cycle', () => {
  const r = run({ claims: 3, unwritable: [CacheKeys.RECON_CHECK_AT] });
  assert.equal(kickSql(r).length, 0);
  assert.equal(recon(r), 0);
});

test('K5 claims held and a new ARC item receipt: go at once, watermark moves', () => {
  const r = run({ claims: 2, rcptMax: 105, arcCount: 1,
    store: { [CacheKeys.RECON_RCPT_ID]: '100', [CacheKeys.RECON_SUBMIT_AT]: String(1e12 - 2 * MIN) } });
  assert.equal(recon(r), 1);
  assert.equal(r.store[CacheKeys.RECON_RCPT_ID], '105');
  assert.match(kickAudits(r)[0][1], /an ARC item receipt was saved, 2 claim/);
});

test('K6 a busy refusal is silent and consumes nothing', () => {
  const r = run({ claims: 2, rcptMax: 105, arcCount: 1, submitError: { name: 'MAP_REDUCE_ALREADY_RUNNING' },
    store: { [CacheKeys.RECON_RCPT_ID]: '100', [CacheKeys.RECON_SUBMIT_AT]: String(1e12 - 2 * MIN) } });
  assert.equal(recon(r), 0);
  assert.equal(r.store[CacheKeys.RECON_RCPT_ID], '100', 'receipt still pending for the next check');
  assert.equal(r.store[CacheKeys.RECON_SUBMIT_AT], String(1e12 - 2 * MIN), 'submit stamp unchanged');
  assert.equal(kickAudits(r).length, 0);
});

test('K7 only non-ARC receipts: no submit, but they are not re-counted', () => {
  const r = run({ claims: 2, rcptMax: 105, arcCount: 0,
    store: { [CacheKeys.RECON_RCPT_ID]: '100', [CacheKeys.RECON_SUBMIT_AT]: String(1e12 - 5 * MIN) } });
  assert.equal(recon(r), 0);
  assert.equal(r.store[CacheKeys.RECON_RCPT_ID], '105');
});

test('K8 claims held for 15 min with no receipt: backstop', () => {
  const r = run({ claims: 1, rcptMax: null,
    store: { [CacheKeys.RECON_RCPT_ID]: '100', [CacheKeys.RECON_SUBMIT_AT]: String(1e12 - 16 * MIN) } });
  assert.equal(recon(r), 1);
  assert.match(kickAudits(r)[0][1], /backstop, 1 claim/);
});

test('K9 unseeded watermark seeds without counting every old receipt as new', () => {
  const r = run({ claims: 1, rcptMax: 130278, store: { [CacheKeys.RECON_SUBMIT_AT]: String(1e12 - 5 * MIN) } });
  assert.equal(kickSql(r).some((s) => /EXISTS/.test(s)), false, 'no EXISTS scan over history');
  assert.equal(recon(r), 0);
  assert.equal(r.store[CacheKeys.RECON_RCPT_ID], '130278');
});

test('K10 claims unreadable (no record type, e.g. prod before X.2): never submits', () => {
  const r = run({ claims: null });
  assert.equal(recon(r), 0);
  assert.equal(kickAudits(r).length, 0);
});

test('K11 any other failure is reported once, then silent', () => {
  const opt = { claims: 0, submitError: { name: 'SSS_INVALID_SCRIPTLET_ID', message: 'no such script' } };
  const first = run(opt);
  assert.equal(kickAudits(first).length, 1);
  assert.match(kickAudits(first)[0][0], /could not be started/);
  const again = run(Object.assign({}, opt, { store: first.store, now: 1e12 + 2 * MIN }));
  assert.equal(kickAudits(again).length, 0, 'same message, deduped');
  assert.equal(again.submits[0], OWN_DEPLOY);
});

test('K13 a missed submit stamp is covered by the reconciler\'s own heartbeat', () => {
  // The live double sweep of 2026-09-23 07:59: SUBMIT_AT read as absent.
  const lastRun = new Date(1e12 - 4 * MIN).toISOString();
  const r = run({ claims: 0, store: { [CacheKeys.RECON_LAST_RUN]: lastRun } });
  assert.equal(recon(r), 0, 'ran 4 min ago by its heartbeat: no hourly sweep');
  const r2 = run({ claims: 2, rcptMax: null,
    store: { [CacheKeys.RECON_RCPT_ID]: '100', [CacheKeys.RECON_LAST_RUN]: new Date(1e12 - 16 * MIN).toISOString() } });
  assert.equal(recon(r2), 1, 'heartbeat 16 min old with claims: backstop still fires');
  const r3 = run({ claims: 0, store: { [CacheKeys.RECON_LAST_RUN]: 'not a date' } });
  assert.equal(recon(r3), 1, 'an unreadable heartbeat falls back to the stamp alone');
});

test('K12 the kick never names the builder\'s own deployment', () => {
  const src = readFileSync(MR, 'utf8');
  const kick = src.slice(src.indexOf('const kickReconciler'), src.indexOf('Fallback display names'));
  assert.equal(/runtime\.getCurrentScript\(\)/.test(kick), false);
  assert.match(kick, /deploymentId: RECON_DEPLOY/);
  const fin = src.slice(src.lastIndexOf('rescheduleSelf();'));
  assert.ok(fin.indexOf('kickReconciler();') > 0, 'kick runs after the reschedule');
});
