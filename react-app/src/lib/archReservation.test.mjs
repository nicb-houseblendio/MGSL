/**
 * Feedback 8, phase 2: reserving a bundle that is still on the water.
 *
 * Two layers under test, both the SHIPPED source:
 *   1. shared/archReservation.js, the claim record's one definition;
 *   2. archOrderCreate.resolveLines, with its queries faked by pattern, for the
 *      pre-arrival branch, the claim gate and the unattributed-commitment fix.
 *
 * What the fakes stand for was MEASURED in sandbox on 2026-09-23 by a probe run
 * as customrole2184 (the endpoint's role): a duplicate externalId is refused
 * with DUP_CSTM_RCRD_ENTRY "There is already a Custom Record Entry with that
 * name"; that role gets INSUFFICIENT_PERMISSION writing the lot record. The
 * write-side flow (claim, save, finalize, release) is also run live; these tests
 * pin the decisions, not NetSuite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SHARED = join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared');

const loadAmd = (file, table) => {
  let mod = null;
  const define = (deps, factory) => {
    mod = factory(...deps.map((d) => {
      if (!(d in table)) throw new Error('unfaked dep ' + d + ' in ' + file);
      return table[d];
    }));
  };
  new Function('define', readFileSync(join(SHARED, file), 'utf8'))(define);
  return mod;
};

const Reservation = loadAmd('archReservation.js', {});

/* ══ 1. The claim record ═════════════════════════════════════════════════ */

test('readClaims maps rows, marks pending, keys lines by <soId>:<uniquekey>', () => {
  const q = { runSuiteQL: () => ({ asMappedResults: () => [
    { claimid: 7, lotid: 52870, lotno: '344950-1', soid: 130304, sonumber: 'SO-ARC-25', customer: 'Acme', linekey: 99001, itemid: 3150, since: '2026-09-23 01:00:00', lotonhand: 0 },
    { claimid: 8, lotid: 52871, lotno: '344950-2', soid: null, linekey: null, itemid: 3340, since: '2026-09-23 01:05:00', lotonhand: null },
  ] }) };
  const c = Reservation.readClaims(q);
  assert.equal(c.sourced, true);
  assert.equal(c.byLotId['52870'].soNumber, 'SO-ARC-25');
  assert.equal(c.byLotId['52870'].pending, false);
  assert.equal(c.byLotId['52871'].pending, true);
  assert.ok(c.byLine['130304:99001']);
  assert.equal(Object.keys(c.byLine).length, 1, 'a pending claim names no line');
});

test('readClaims says so when the record cannot be read, rather than returning an empty lock table', () => {
  const q = { runSuiteQL: () => { const e = new Error("Invalid search type: customrecord_arch_res"); e.name = 'SSS_SEARCH_ERROR'; throw e; } };
  const c = Reservation.readClaims(q);
  assert.equal(c.sourced, false);
  assert.match(c.error, /customrecord_arch_res/);
});

test('the claims read reads EVERY claim (inactive included, see F4) and the lot stock over all locations', () => {
  assert.match(Reservation.CLAIMS_SQL, /FROM customrecord_arch_res c/);
  assert.match(Reservation.CLAIMS_SQL, /SUM\(inl\.quantityonhand\) FROM inventorynumberlocation inl\s+WHERE inl\.inventorynumber = c\.custrecord_arch_res_lot/);
});

const recFake = (saveImpl) => {
  const made = [];
  return {
    made,
    create: () => {
      const vals = {};
      return { setValue: ({ fieldId, value }) => { vals[fieldId] = value; }, save: () => { made.push(vals); return saveImpl(vals); } };
    },
  };
};

test('claim keys the lock on the LOT ID, never the name', () => {
  const r = recFake(() => 41);
  const res = Reservation.claim(r, 52870, 3150);
  assert.deepEqual(res, { ok: true, claimId: 41 });
  assert.equal(r.made[0].externalid, 'arch-res-52870');
  assert.equal(r.made[0].custrecord_arch_res_lot, 52870);
});

test('a duplicate claim is "taken", in the words NetSuite actually used', () => {
  const r = recFake(() => { const e = new Error('There is already a Custom Record Entry with that name'); e.name = 'DUP_CSTM_RCRD_ENTRY'; throw e; });
  assert.deepEqual(Reservation.claim(r, 52870, 3150), { ok: false, taken: true });
});

test('any OTHER claim failure throws: a writer that cannot tell if it holds the lock must stop', () => {
  const r = recFake(() => { const e = new Error('Permission Violation'); e.name = 'INSUFFICIENT_PERMISSION'; throw e; });
  assert.throws(() => Reservation.claim(r, 52870, 3150), /Permission/);
});

test('release of a claim already gone is not an error; anything else is', () => {
  const gone = { delete: () => { const e = new Error('Record does not exist'); e.name = 'RCRD_DSNT_EXIST'; throw e; } };
  assert.equal(Reservation.release(gone, 5), false);
  const boom = { delete: () => { throw new Error('Unexpected'); } };
  assert.throws(() => Reservation.release(boom, 5));
});

test('ageMinutes reads the account clock on both sides', () => {
  assert.equal(Reservation.ageMinutes('2026-09-23 01:00:00', '2026-09-23 01:31:00'), 31);
  assert.equal(Reservation.ageMinutes('', '2026-09-23 01:31:00'), null);
});

/* ══ 2. The endpoint's line resolution ═══════════════════════════════════ */

const STATE = (o) => ({ lotid: 52870, lotname: '344950-1', itemid: 3150, itemcode: 'PUR44KDSRT', department: 'Trading', subsidiary: 'ARC', locationid: 22, storedqty: 0, stockunit: 5, saleunit: 5, rate: 0.001, ...o });

const endpoint = ({ states = [STATE()], claims = [], claimsThrow = false, poLines = [], flags = [], flagsThrow = false, unattrib = [], committed = [], poRcv = [] } = {}) => {
  const sql = [];
  const errors = [];
  const query = {
    runSuiteQL: ({ query: q }) => {
      sql.push(q);
      const rows = (() => {
        if (/customrecord_arch_res/.test(q)) { if (claimsThrow) throw new Error('Invalid search type: customrecord_arch_res'); return claims; }
        if (/custbody_po_intransit_journal/.test(q)) { if (flagsThrow) throw new Error('Unknown identifier'); return flags; }
        if (/tl\.quantityshiprecv AS rcv FROM transactionline tl/.test(q)) return poRcv;
        if (/t\.type = 'PurchOrd'/.test(q)) return poLines;
        if (/FROM inventorynumberlocation inl/.test(q)) return states;
        if (/LEFT JOIN inventoryassignment ia/.test(q)) return unattrib;
        if (/JOIN inventoryassignment ia/.test(q) && /SalesOrd/.test(q)) return committed;
        return [];
      })();
      return { asMappedResults: () => rows };
    },
  };
  const search = {
    create: () => ({ run: () => ({ each: () => {} }) }),
    createColumn: (o) => o,
  };
  const log = { audit: () => {}, error: (t, m) => errors.push(t + ' | ' + m), debug: () => {} };
  const runtime = { getCurrentScript: () => ({ getParameter: () => null }), getCurrentUser: () => ({ id: 3136 }) };
  const inert = new Proxy({}, { get: () => () => { throw new Error('unexpected'); } });
  const splitLib = { toDisplay: (q, r) => q / r, toStored: (q, r) => q * r };
  const mod = loadAmd('archOrderCreate.js', {
    'N/record': inert, 'N/query': query, 'N/search': search, 'N/runtime': runtime, 'N/log': log,
    'N/render': inert, 'N/email': inert, 'N/currency': { exchangeRate: () => 1 },
    './archSplitExecute': splitLib, './archReservation': Reservation,
  });
  return { mod, sql, errors };
};

const PO_LINE = (o) => ({ lotid: 52870, poid: 900, ponumber: 'PO344950', lineid: 1, locationid: 22, assignedqty: 1.4, lineqty: 1.4, received: 0, billed: 0, ...o });
const LINE = (o) => ({ lotId: 52870, locationId: 22, itemId: 3150, qty: 1400, pricePerUnit: 5, ...o });

test('A1 a bundle on the water (take ownership posted) resolves as a WHOLE-bundle pre-arrival line', () => {
  const { mod } = endpoint({ poLines: [PO_LINE()], flags: [{ poid: 900, je: '129879', agency: 'F', tstatus: 'B' }] });
  const r = mod.resolveLines([LINE()]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].preArrival, true);
  assert.equal(r.lines[0].displayQty, 1400);
  assert.equal(r.lines[0].storedQty, 1.4);
  assert.equal(r.lines[0].poNumber, 'PO344950');
});

test('A2 On Order (no journal, not billed) is refused: visibility only, per MA', () => {
  const { mod } = endpoint({ poLines: [PO_LINE()], flags: [{ poid: 900, je: '', agency: 'F', tstatus: 'B' }] });
  const r = mod.resolveLines([LINE()]);
  assert.equal(r.lines.length, 0);
  assert.match(r.problems[0], /on order, not in transit yet/);
});

test('A3 billed ahead of receipt counts as in transit, same rule as the cache', () => {
  const { mod } = endpoint({ poLines: [PO_LINE({ billed: 1.4 })], flags: [{ poid: 900, je: '', agency: 'F', tstatus: 'B' }] });
  assert.equal(mod.resolveLines([LINE()]).lines[0].preArrival, true);
});

test('A4 a closed PO and an agency PO without journal are not in transit', () => {
  const closed = endpoint({ poLines: [PO_LINE()], flags: [{ poid: 900, je: '129879', agency: 'F', tstatus: 'PurchOrd:H' }] });
  assert.match(closed.mod.resolveLines([LINE()]).problems[0], /closed PO/);
  const agency = endpoint({ poLines: [PO_LINE({ billed: 1.4 })], flags: [{ poid: 900, je: '', agency: 'T', tstatus: 'B' }] });
  assert.match(agency.mod.resolveLines([LINE()]).problems[0], /not in transit/);
});

test('A5 the PO flag read failing refuses, never guesses in transit', () => {
  const { mod, errors } = endpoint({ poLines: [PO_LINE()], flagsThrow: true });
  assert.match(mod.resolveLines([LINE()]).problems[0], /could not be read/);
  assert.ok(errors.some((e) => /UNREADABLE/.test(e)));
});

test('A6 a lot on two open PO lines (Make Copy) is refused', () => {
  const { mod } = endpoint({
    poLines: [PO_LINE(), PO_LINE({ poid: 901, ponumber: 'PO344951', lineid: 3 })],
    flags: [{ poid: 900, je: 'x', tstatus: 'B' }, { poid: 901, je: 'x', tstatus: 'B' }],
  });
  assert.match(mod.resolveLines([LINE()]).problems[0], /sits on 2 open PO lines/);
});

test('A7 whole bundle only: a partial quantity and a split are both refused', () => {
  const env = { poLines: [PO_LINE()], flags: [{ poid: 900, je: 'x', tstatus: 'B' }] };
  assert.match(endpoint(env).mod.resolveLines([LINE({ qty: 700 })]).problems[0], /reserved whole/);
  assert.match(endpoint(env).mod.resolveLines([LINE({ isSplit: true, splitTargetQty: 700 })]).problems[0], /cannot be\s+split yet/);
});

test('A8 the same bundle twice on one order is refused', () => {
  const { mod } = endpoint({ poLines: [PO_LINE()], flags: [{ poid: 900, je: 'x', tstatus: 'B' }] });
  const r = mod.resolveLines([LINE(), LINE()]);
  assert.equal(r.lines.length, 1);
  assert.match(r.problems[0], /another line of this order/);
});

test('A9 a partly received line is not "on the water"', () => {
  const { mod } = endpoint({ poLines: [PO_LINE({ received: 0.4 })], flags: [{ poid: 900, je: 'x', tstatus: 'B' }] });
  assert.match(mod.resolveLines([LINE()]).problems[0], /partly received/);
});

test('B1 a CLAIMED bundle is refused on the pre-arrival path, naming the order', () => {
  const { mod } = endpoint({
    poLines: [PO_LINE()], flags: [{ poid: 900, je: 'x', tstatus: 'B' }],
    claims: [{ claimid: 7, lotid: 52870, soid: 130304, sonumber: 'SO-ARC-25', customer: 'Acme', linekey: 5 }],
  });
  assert.match(mod.resolveLines([LINE()]).problems[0], /already reserved on SO-ARC-25 for Acme/);
});

test('B2 a claimed bundle that has LANDED (stock, no assignment yet) is refused too', () => {
  const { mod } = endpoint({
    states: [STATE({ storedqty: 1.4 })],
    claims: [{ claimid: 7, lotid: 52870, soid: 130304, sonumber: 'SO-ARC-25', linekey: 5 }],
  });
  assert.match(mod.resolveLines([LINE()]).problems[0], /already reserved on SO-ARC-25/);
});

test('B3 a pending claim (another order mid-save) is refused', () => {
  const { mod } = endpoint({ states: [STATE({ storedqty: 1.4 })], claims: [{ claimid: 8, lotid: 52870 }] });
  assert.match(mod.resolveLines([LINE()]).problems[0], /being saved right now/);
});

test('B4 claims unreadable refuses EVERY line, on hand included', () => {
  const { mod, errors } = endpoint({ states: [STATE({ storedqty: 1.4 })], claimsThrow: true });
  const r = mod.resolveLines([LINE()]);
  assert.equal(r.lines.length, 0);
  assert.match(r.problems[0], /reservations could not be read/);
  assert.ok(errors.some((e) => /RESERVATIONS UNREADABLE/.test(e)));
});

test('B5 an unclaimed on-hand bundle still sells exactly as before', () => {
  const { mod } = endpoint({ states: [STATE({ storedqty: 1.4 })] });
  const r = mod.resolveLines([LINE({ qty: 1400 })]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.lines[0].preArrival, undefined);
});

test('C1 a claimed SO line with no lot is NOT an unattributed commitment on the pair', () => {
  const unattrib = [{ itemid: 3150, locationid: 22, lineid: 3, linekey: 99001, tranid: 130304, lineqty: -1.4, shipped: 0, assignedqty: null }];
  const claims = [{ claimid: 7, lotid: 52999, soid: 130304, sonumber: 'SO-ARC-25', linekey: 99001 }];
  const { mod } = endpoint({ states: [STATE({ storedqty: 1.4 })], unattrib, claims });
  assert.deepEqual(mod.resolveLines([LINE()]).problems, [], 'another bundle of the item must stay sellable');
});

test('C2 the SAME line without a claim still locks the pair (unchanged conservative rule)', () => {
  const unattrib = [{ itemid: 3150, locationid: 22, lineid: 3, linekey: 99001, tranid: 130304, lineqty: -1.4, shipped: 0, assignedqty: null }];
  const { mod } = endpoint({ states: [STATE({ storedqty: 1.4 })], unattrib });
  assert.match(mod.resolveLines([LINE()]).problems[0], /name no lot/);
});

test('C3 the unattributed read selects the line uniquekey it needs', () => {
  const { mod, sql } = endpoint({ states: [STATE({ storedqty: 1.4 })] });
  mod.resolveLines([LINE()]);
  assert.ok(sql.some((q) => /LEFT JOIN inventoryassignment ia/.test(q) && /tl\.uniquekey\s+AS linekey/.test(q)));
});

/* ══ 3. createOrder's ordering, at source level ═══════════════════════════ */

const SRC = readFileSync(join(SHARED, 'archOrderCreate.js'), 'utf8');

test('D1 claims are taken AFTER the lines are built and BEFORE the save', () => {
  const take = SRC.indexOf('takeClaims(preLines, idempotencyKey);');
  const save = SRC.indexOf('soId = so.save({ enableSourcing: true, ignoreMandatoryFields: false });');
  const lines = SRC.indexOf('const lineWrites = resolved.lines.map(');
  assert.ok(take > lines && take < save, { take, lines, save });
});

test('D2 a failed save releases every claim it took, first thing in the catch', () => {
  const save = SRC.indexOf('soId = so.save({ enableSourcing: true, ignoreMandatoryFields: false });');
  const catchAt = SRC.indexOf('} catch (e) {', save);
  const rel = SRC.indexOf("releaseClaims(preLines, 'the order did not save');", catchAt);
  assert.ok(rel > catchAt && rel - catchAt < 200);
});

test('D3 claims are finalized with the saved SO and the line key, and verification skips pre-arrival lines', () => {
  assert.match(SRC, /Reservation\.finalize\(record, l\.claimId, soId, l\.lineKey\)/);
  assert.match(SRC, /verifyAssignments\(soId, stockLines, priorAssignments\)/);
  assert.match(SRC, /line\.lineKey = int\(so\.getSublistValue\(\{\s*sublistId: 'item', fieldId: 'lineuniquekey', line: target,/);
});

/* ══ 4. The reconciler's rules (2.7, 2.7b, 2.7c, 3.1) ═════════════════════ */

const HELD = { claimId: 7, lotId: 52870, lotNo: '344950-1', soId: 130304, soNumber: 'SO-ARC-25', lineKey: 99001, itemId: 3150, since: '2026-09-23 01:00:00', nowAcct: '2026-09-23 01:10:00' };
const FACTS = (o) => ({
  so: { type: 'SalesOrd', status: 'SalesOrd:B' },
  line: { item: 3150, location: 22, qtyBase: 1.4, shippedBase: 0, closed: false },
  stock: [{ location: 22, onHandBase: 0, onOrderBase: 1.4 }],
  assignedOnLineBase: 0, otherCommitBase: 0,
  poLines: [{ closedLine: false, closedPo: false, orderedBase: 1.4, receivedBase: 0, bundleBase: 1.4 }],
  poHasReceipt: false, ...o,
});
const decide = (c, f) => Reservation.decideClaim(c, f);

test('R1 on the water, all well: keep, no exception', () => {
  const d = decide(HELD, FACTS());
  assert.equal(d.action, 'keep'); assert.equal(d.exception, null);
});

test('R2 SO-side failures RELEASE: cancelled, closed, gone, line removed/closed/fulfilled', () => {
  assert.equal(decide(HELD, FACTS({ so: { type: 'SalesOrd', status: 'SalesOrd:C' } })).action, 'release');
  assert.equal(decide(HELD, FACTS({ so: { type: 'SalesOrd', status: 'H' } })).action, 'release');
  assert.equal(decide(HELD, FACTS({ so: null })).action, 'release');
  assert.equal(decide(HELD, FACTS({ line: null })).action, 'release');
  assert.equal(decide(HELD, FACTS({ line: { item: 3150, location: 22, qtyBase: 1.4, shippedBase: 0, closed: true } })).action, 'release');
  assert.equal(decide(HELD, FACTS({ line: { item: 3150, location: 22, qtyBase: 1.4, shippedBase: 1.4, closed: false } })).action, 'release');
});

test('R3 the line now carries another item (Update SO rewrites by position): release AND alert', () => {
  const d = decide(HELD, FACTS({ line: { item: 9999, location: 22, qtyBase: 1.4, shippedBase: 0, closed: false } }));
  assert.equal(d.action, 'release'); assert.equal(d.alert, true);
});

test('R4 a billed or fulfilled-status SO with an OPEN line is NOT released on status alone', () => {
  assert.equal(decide(HELD, FACTS({ so: { type: 'SalesOrd', status: 'SalesOrd:G' } })).action, 'keep');
});

test('R5 pending claims: kept while young, released after the TTL, and an SO deleted under it releases now', () => {
  const pend = { ...HELD, soId: 0, lineKey: 0, soNumber: '' };
  assert.equal(decide({ ...pend, nowAcct: '2026-09-23 01:29:00' }, FACTS()).action, 'keep');
  assert.equal(decide({ ...pend, nowAcct: '2026-09-23 01:30:00' }, FACTS()).action, 'release');
  assert.equal(decide({ ...pend, lineKey: 99001 }, FACTS()).action, 'release', 'SET_NULL left the line key');
});

test('R6 landed at the line location: hand off the whole open quantity and release', () => {
  const d = decide(HELD, FACTS({ stock: [{ location: 22, onHandBase: 1.4, onOrderBase: 0 }] }));
  assert.equal(d.action, 'handoff'); assert.equal(d.handoffBase, 1.4); assert.equal(d.releaseAfterHandoff, true);
});

test('R7 landed SHORT: hand off what arrived, keep the claim, report received short', () => {
  const d = decide(HELD, FACTS({ stock: [{ location: 22, onHandBase: 1.1, onOrderBase: 0 }] }));
  assert.equal(d.action, 'handoff'); assert.equal(d.handoffBase, 1.1);
  assert.equal(d.releaseAfterHandoff, false); assert.equal(d.exception, 'VAL_RECEIVED_SHORT');
});

test('R8 landed at ANOTHER location: keep, report, no hand-off', () => {
  const d = decide(HELD, FACTS({ stock: [{ location: 99, onHandBase: 1.4, onOrderBase: 0 }] }));
  assert.equal(d.action, 'keep'); assert.equal(d.exception, 'VAL_LOCATION_CHANGED');
});

test('R9 already handed over (line carries the lot): release', () => {
  assert.equal(decide(HELD, FACTS({ assignedOnLineBase: 1.4, stock: [{ location: 22, onHandBase: 1.4 }] })).action, 'release');
});

test('R10 another SO holds the landed bundle: keep, alert, never hand off', () => {
  const d = decide(HELD, FACTS({ otherCommitBase: 0.5, stock: [{ location: 22, onHandBase: 1.4 }] }));
  assert.equal(d.action, 'keep'); assert.equal(d.alert, true);
});

test('R11 supply-side exceptions are KEPT and named, never released', () => {
  const cases = [
    [{ poLines: [] }, 'VAL_REMOVED_FROM_PO'],
    [{ poLines: [{ closedLine: true, closedPo: false, orderedBase: 1.4, bundleBase: 1.4 }] }, 'VAL_PO_LINE_CLOSED'],
    [{ poLines: [{ closedLine: false, closedPo: true, orderedBase: 1.4, bundleBase: 1.4 }] }, 'VAL_PO_LINE_CLOSED'],
    [{ poHasReceipt: true }, 'VAL_RECEIVED_WITHOUT'],
    [{ poLines: [{ closedLine: false, closedPo: false, orderedBase: 1.0, bundleBase: 1.4 }] }, 'VAL_PO_LINE_CLOSED'],
    [{ line: { item: 3150, location: 22, qtyBase: 2, shippedBase: 0, closed: false } }, 'VAL_SO_LINE_ABOVE_BUNDLE'],
  ];
  for (const [o, code] of cases) {
    const d = decide(HELD, FACTS(o));
    assert.equal(d.action, 'keep', code); assert.equal(d.exception, code);
  }
});

/* ══ 5. Review 2026-09-23 fixes ══════════════════════════════════════════ */

test('F1 (HIGH 1) second run after a SHORT hand-off keeps and reports, never re-gives the same wood', () => {
  const d = decide(HELD, FACTS({ stock: [{ location: 22, onHandBase: 1.0 }], assignedOnLineBase: 1.0, assignedAllOnLineBase: 1.0 }));
  assert.equal(d.action, 'keep'); assert.equal(d.exception, 'VAL_RECEIVED_SHORT'); assert.equal(d.handoffBase, 0);
});

test('F2 (HIGH 2) a line already covered by ANOTHER bundle releases this claim', () => {
  const d = decide(HELD, FACTS({ assignedOnLineBase: 0, assignedAllOnLineBase: 1.4 }));
  assert.equal(d.action, 'release'); assert.match(d.reason, /covered by another bundle/);
});

test('F3 (HIGH 2) a hand-off is capped by what the line still lacks from ALL lots', () => {
  const d = decide(HELD, FACTS({ stock: [{ location: 22, onHandBase: 1.4 }], assignedOnLineBase: 0, assignedAllOnLineBase: 0.5 }));
  assert.equal(d.action, 'handoff'); assert.ok(Math.abs(d.handoffBase - 0.9) < 1e-9, d.handoffBase); assert.equal(d.releaseAfterHandoff, true);
});

test('F4 an inactivated claim is released, and still read (it blocks a new claim otherwise)', () => {
  assert.equal(decide({ ...HELD, inactive: true }, FACTS()).action, 'release');
  assert.doesNotMatch(Reservation.CLAIMS_SQL, /WHERE c\.isinactive/);
  assert.match(Reservation.CLAIMS_SQL, /c\.custrecord_arch_res_key AS orderkey, c\.isinactive AS inactive/);
});

test('F5 (HIGH 3) the claim carries the order key, and claims are named even when the stock save throws', () => {
  const r = recFake(() => 41);
  Reservation.claim(r, 52870, 3150, 'hbres-real-0002');
  assert.equal(r.made[0].custrecord_arch_res_key, 'hbres-real-0002');
  assert.match(SRC, /takeClaims\(preLines, idempotencyKey\);/);
  const at = SRC.indexOf('unplaced = assignLots(soId, resolved.lines, priorLineKeys);');
  const fin = SRC.indexOf('Reservation.finalize(record, l.claimId, soId, l.lineKey)', at);
  const rethrow = SRC.indexOf('if (assignError) throw assignError;', fin);
  assert.ok(at > 0 && fin > at && rethrow > fin, { at, fin, rethrow });
  assert.match(SRC.slice(at - 120, at), /try \{\s*$/);
});

test('F6 the reconciler recovers a pending claim by its key and hands failures to the lot, not to null', () => {
  const mr = readFileSync(join(SHARED, '../entry_points/mr/mcgi_mr_arch_reservation.js'), 'utf8');
  assert.match(mr, /'ARCH-ORDER-' \+ c\.orderKey, 'ARCH-ORDER-' \+ c\.orderKey \+ '\[%',\s*'%\[ARCH-APPEND:' \+ c\.orderKey \+ '\]%'/);
  assert.match(mr, /exception: 'VAL_HANDOFF_FAILED'/);
  assert.match(mr, /f\.assignedAllOnLineBase = onLine\.reduce/);
});

test('F7 no N/query in the reconciler filters inventoryassignment.transactionline directly (returns 0 rows, measured)', () => {
  const mr = readFileSync(join(SHARED, '../entry_points/mr/mcgi_mr_arch_reservation.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(mr, /FROM inventoryassignment ia '\s*\+\s*'WHERE ia\.transaction = \? AND ia\.transactionline = \?/);
  assert.match(mr, /JOIN inventoryassignment ia ON ia\.transaction = tl\.transaction AND ia\.transactionline = tl\.id ' \+\s*'WHERE tl\.transaction = \? AND tl\.uniquekey = \?'/);
});

/* ══ 6. Final review fixes ═══════════════════════════════════════════════ */

test('G1 (M1) a short landing whose landed part SHIPPED keeps its claim for the rest', () => {
  // line 1.0, landed 0.6 handed over and shipped; 0.4 still wanted.
  const d = decide(HELD, FACTS({
    line: { item: 3150, location: 22, qtyBase: 1.0, shippedBase: 0.6, closed: false },
    stock: [{ location: 22, onHandBase: 0, onOrderBase: 0 }],
    assignedOnLineBase: 0.6, assignedAllOnLineBase: 0.6,
    poLines: [{ closedLine: false, closedPo: false, orderedBase: 1.0, receivedBase: 0.6, bundleBase: 1.0 }],
  }));
  assert.notEqual(d.action, 'release', d.reason);
});

test('G2 (M1) another bundle that covered part of the line and shipped does not release this claim', () => {
  const d = decide(HELD, FACTS({
    line: { item: 3150, location: 22, qtyBase: 1.4, shippedBase: 0.5, closed: false },
    assignedOnLineBase: 0, assignedAllOnLineBase: 0.5,
  }));
  assert.notEqual(d.action, 'release', d.reason);
});

test('G3 (M1) the rest of a short bundle landing later is handed over, net of what already shipped', () => {
  const d = decide(HELD, FACTS({
    line: { item: 3150, location: 22, qtyBase: 1.0, shippedBase: 0.6, closed: false },
    stock: [{ location: 22, onHandBase: 0.4, onOrderBase: 0 }],
    assignedOnLineBase: 0.6, assignedAllOnLineBase: 0.6,
  }));
  assert.equal(d.action, 'handoff'); assert.ok(Math.abs(d.handoffBase - 0.4) < 1e-9, d.handoffBase);
  assert.equal(d.releaseAfterHandoff, true);
});

test('G4 (M2) a pending claim whose order exists but whose line is ambiguous is KEPT with an alert', () => {
  const pend = { ...HELD, soId: 0, lineKey: 0, nowAcct: '2026-09-23 03:00:00' };
  const d = decide(pend, FACTS({ orderFound: true }));
  assert.equal(d.action, 'keep'); assert.equal(d.alert, true);
});

test('G5 (L3) the endpoint refuses a bundle on a PO that already has a receipt, as the reconciler reports it', () => {
  const env = { poLines: [PO_LINE()], flags: [{ poid: 900, je: 'x', tstatus: 'B' }] };
  assert.equal(endpoint(env).mod.resolveLines([LINE()]).lines[0].preArrival, true, 'control: no receipt, accepted');
  const r = endpoint({ ...env, poRcv: [{ poid: 900, rcv: 0 }, { poid: 900, rcv: 0.5 }] }).mod.resolveLines([LINE()]);
  assert.equal(r.lines.length, 0);
  assert.match(r.problems[0], /already partly received/);
});
