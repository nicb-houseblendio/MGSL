/**
 * Sales rep vs Sales Team on an ARCH order.
 *
 * The regression this file exists for is Marc-Antoine's, 2026-09-08: "Quand je
 * change de rep, le split disparaît." The cause was one state field holding a rep
 * id and a team name by turns, so `repPicked` keeping `team` is the assertion that
 * matters most here.
 *
 * The splits quoted are real sandbox rows from `transactionsalesteam`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitKind,
  describeOrderSalesTeam,
  emptyRepTeam,
  repPicked,
  orderOpened,
  customerPicked,
  salesRepOk,
  NEW_ORDER_SPLIT_HEADLINE,
  NEW_ORDER_SPLIT_DETAIL,
} from './archSalesTeamSplit.ts';

/** SO-CWP-001352 / transaction 126664: Samuel Nadon 0.5, Justin Loveland 0.5. */
const EVEN = {
  soNo: 'SO-CWP-001352',
  leadRep: 'Justin Loveland',
  leadRepId: '2090',
  shared: true,
  tied: true,
};
/** Group 2808 "Rettenmeier/Phil": Philippe Grand Maitre 0.67, Samuel Nadon 0.33. */
const WEIGHTED = {
  soNo: 'SO-CWP-001348',
  leadRep: 'Philippe Grand Maitre',
  leadRepId: '2093',
  shared: true,
  tied: false,
};
/** Transaction 125745: Dany Arsenault 1. */
const SOLE = {
  soNo: 'SO-CWP-001339',
  leadRep: 'Samuel Nadon',
  leadRepId: '2094',
  shared: false,
  tied: false,
};

test('splitKind reads the shape of a real sublist', () => {
  assert.equal(splitKind(SOLE), 'sole');
  assert.equal(splitKind(EVEN), 'even');
  assert.equal(splitKind(WEIGHTED), 'weighted');
  assert.equal(splitKind(null), null);
  // An order whose rep the caller's role could not resolve has no split to show.
  assert.equal(splitKind({ ...EVEN, leadRepId: '' }), null);
});

test('the description states the split and never invents a percentage', () => {
  const sole = describeOrderSalesTeam(SOLE);
  assert.equal(sole.kind, 'sole');
  assert.match(sole.headline, /Samuel Nadon \(100%\)/);

  const even = describeOrderSalesTeam(EVEN);
  assert.match(even.headline, /Justin Loveland/);
  assert.match(even.headline, /split evenly/);
  assert.match(even.detail, /SO-CWP-001352/);

  const weighted = describeOrderSalesTeam(WEIGHTED);
  assert.match(weighted.headline, /largest share/);

  // 🔴 100% on a one-rep order is arithmetic, not a guess. Any OTHER percentage
  // would be one, because the service reports the shape of the split and not its
  // members. Nothing shared may carry a number.
  for (const d of [even, weighted]) {
    assert.equal(/\d+(\.\d+)?\s*%/.test(d.headline), false, d.headline);
    assert.equal(/\d+(\.\d+)?\s*%/.test(d.detail), false, d.detail);
  }
  assert.equal(describeOrderSalesTeam(null), null);
});

test('the new-order note names the real source and claims nothing else', () => {
  assert.match(NEW_ORDER_SPLIT_HEADLINE, /NetSuite/);
  assert.match(NEW_ORDER_SPLIT_DETAIL, /Setup > Sales > Sales Teams/);
  assert.match(NEW_ORDER_SPLIT_DETAIL, /cannot read or change/);
  assert.equal(/\d+(\.\d+)?\s*%/.test(NEW_ORDER_SPLIT_DETAIL), false);
});

test('🔴 changing the rep KEEPS the split — the reported regression', () => {
  // Open SO-CWP-001352, which really is a 50/50, then change the rep.
  const opened = orderOpened('2090', EVEN);
  assert.equal(opened.salesRepId, '2090');
  assert.equal(opened.team, EVEN);

  const changed = repPicked(opened, '2094', true);
  assert.equal(changed.salesRepId, '2094');
  // THE ASSERTION. Before the fix the rep and the team shared one string, so this
  // was null and the panel disappeared.
  assert.equal(changed.team, EVEN, 'changing the rep must not wipe the commission split');
  assert.equal(describeOrderSalesTeam(changed.team).kind, 'even');

  // And again, twice over, because the old bug only needed one keystroke.
  const twice = repPicked(repPicked(changed, '2093', true), '3163', true);
  assert.equal(twice.salesRepId, '3163');
  assert.equal(twice.team, EVEN);
});

test('the live id and the offline placeholder are never both set', () => {
  const live = repPicked(emptyRepTeam(), '2090', true);
  assert.equal(live.salesRepId, '2090');
  assert.equal(live.offlineRep, '');

  const offline = repPicked(emptyRepTeam(), 'Alec Wolf', false);
  assert.equal(offline.salesRepId, '', 'a placeholder name must never reach salesRepId');
  assert.equal(offline.offlineRep, 'Alec Wolf');

  // A placeholder left over from a disconnected session is dropped the moment a
  // real rep is picked, so it cannot satisfy the required field.
  const recovered = repPicked(offline, '2090', true);
  assert.equal(recovered.offlineRep, '');
  assert.equal(recovered.salesRepId, '2090');
});

test('orderOpened refuses a team with no resolvable lead', () => {
  assert.equal(orderOpened('2090', { ...EVEN, leadRepId: '' }).team, null);
  assert.equal(orderOpened('', null).salesRepId, '');
  assert.equal(orderOpened('', null).team, null);
});

test('a new customer clears both the rep and the team', () => {
  const s = customerPicked();
  assert.deepEqual(s, { salesRepId: '', offlineRep: '', team: null });
});

test('salesRepOk requires the ID when a live list exists', () => {
  const offline = repPicked(emptyRepTeam(), 'Alec Wolf', false);
  assert.equal(salesRepOk(offline, false), true);
  // 🔴 The defect this replaced: an offline leftover satisfied the field while the
  // dropdown visibly read "Select sales rep" and the draft carried no rep id.
  assert.equal(salesRepOk(offline, true), false);

  const live = repPicked(emptyRepTeam(), '2090', true);
  assert.equal(salesRepOk(live, true), true);
  assert.equal(salesRepOk(emptyRepTeam(), true), false);
  assert.equal(salesRepOk(emptyRepTeam(), false), false);

  // A split alone is not a rep. Opening an order whose rep the role cannot see
  // must not enable Continue.
  assert.equal(salesRepOk(orderOpened('', EVEN), true), false);
});
