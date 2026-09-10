// degradationsIn: what a POPULATED Open Sales Orders tab admits it does not know.
//
// 🔴 WHY THIS FILE EXISTS. The endpoint-first chain added for item 5.b falls back
// to the RESTlet only when the endpoint TOTAL-fails, and `handleGetOpenOrders` is
// built never to total-fail: it carries ONE `success: false` against THREE
// swallowed catches (cost lookup, sales-team read, tagged-item count). Each of
// those returns `success: true` with a full order list, so the guard accepts them,
// the fallback never fires, and the trader reads a confident count over data that
// quietly lost a column. This function is the only thing that notices.
//
// It is a pure function over plain data, so it gets real assertions rather than
// the source greps that cover the rest of the change.
import { degradationsIn } from '../hooks/useArchOpenOrders.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const line = (costSource) => ({ costSource });
const order = (...sources) => ({ lines: sources.map(line) });
const att = (over) => Object.assign({
  orders: 2, fromSalesTeam: 2, fromHeader: 0, unattributed: 0,
  namesUnreadable: 0, salesTeamRead: 'ok', salesTeamError: '', roleLabel: '',
}, over || {});

// ── the healthy case, which is what sandbox reads today ──────────────────────
// Measured 2026-09-10 on the deployed endpoint: 9 of 9 lines costSource rowAverage.
let d = degradationsIn([order('rowAverage', 'rowAverage'), order('rowAverage')], { traderAttribution: att() });
ok('a whole answer produces NO reasons, so the banner stays off', d.length === 0, d);

// ── the cost column ───────────────────────────────────────────────────────────
d = degradationsIn([order('unknown', 'rowAverage')], { traderAttribution: att() });
ok('one uncosted line is counted', d.length === 1 && /^1 line /.test(d[0]), d);
ok('and reads singular', /^1 line could not be costed/.test(d[0]), d);

d = degradationsIn([order('unknown', 'unknown'), order('unknown')], { traderAttribution: att() });
ok('three uncosted lines across two orders are counted together',
  d.length === 1 && /^3 lines could not be costed/.test(d[0]), d);

/* 🔴 THE CLAIM THAT WAS WRONG, pinned so it cannot come back. This said
 * "est. profit is understated". Both halves were false: the screen prints a dash
 * rather than a figure the moment any line lacks a cost (`costKnown`), and
 * `lineProfit` treats an unknown cost as 0, so the one direction it COULD err is
 * over, not under. A notice inside the honesty mechanism that contradicts the
 * cells beside it is this project's signature defect. */
ok('the cost reason does NOT claim profit is understated', !/understated/.test(d.join(' ')), d);
ok('it says the figure is withheld, which is what the cells actually do',
  /shown as a dash rather than a number/.test(d[0]), d);

// ── the rep column ────────────────────────────────────────────────────────────
d = degradationsIn([order('rowAverage')], { traderAttribution: att({ salesTeamRead: 'failed' }) });
ok('a failed sales-team read is a reason', d.some((r) => /sales-team read failed/.test(r)), d);
ok('and says what the trader would SEE, not just that a query threw',
  d.some((r) => /Unassigned/.test(r)), d);

d = degradationsIn([order('rowAverage')], { traderAttribution: att({ salesTeamRead: 'unknown' }) });
ok('"unknown" is not "failed": a service too old to report is not a fault', d.length === 0, d);

// ── both at once ──────────────────────────────────────────────────────────────
d = degradationsIn([order('unknown')], { traderAttribution: att({ salesTeamRead: 'failed' }) });
ok('two independent gaps are two reasons, not one merged sentence', d.length === 2, d);

// ── shape robustness: the service is old, or a field is simply absent ─────────
ok('no attribution block at all does not throw', degradationsIn([order('rowAverage')], {}).length === 0);
ok('an order with no lines array does not throw', degradationsIn([{}], {}).length === 0);
ok('an empty order list yields nothing', degradationsIn([], {}).length === 0);

/* 🔴 taggedItemCount is DELIBERATELY not in here, and this pins the decision.
 * It was, at first. But this list renders on a POPULATED tab, where the count has
 * no bearing on whether the ORDER list is whole, and the only consumer of the
 * count is the empty-state banner, which already branches on null. Reporting it
 * here showed it in the one state where it means nothing and hid it in the one
 * state where it means something. */
ok('a null tagged-item count is not reported as an order-list gap',
  degradationsIn([order('rowAverage')], { taggedItemCount: null, traderAttribution: att() }).length === 0);

// ── copy conventions ──────────────────────────────────────────────────────────
d = degradationsIn([order('unknown')], { traderAttribution: att({ salesTeamRead: 'failed' }) });
ok('no em dashes in anything shown to the client', !d.join(' ').includes('\u2014'), d);
ok('nothing prints null or undefined', !/null|undefined/.test(d.join(' ')), d);
/* Each reason is written to follow a clause, so it starts lowercase; the VIEW
 * capitalises the first one. Pin the contract, since the view relies on it. */
ok('every reason starts lowercase, which is what the view capitalises',
  d.every((r) => r[0] === r[0].toLowerCase()), d);

console.log(fail ? ('# FAIL ' + fail) : '# archDegradations ok');
process.exit(fail ? 1 : 0);
