/**
 * 2026-09-23: the ARCH grid follows the cache on its own, and a trader's own order
 * shows at once. Two pure modules, plus source guards on the hook and screen
 * wiring, since this repo cannot render them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pollVerdict, isRateLimited, ARCH_POLL_MS } from './archAutoRefresh.ts';
import {
  overlayFromOrder,
  pruneOverlay,
  applyOverlay,
  OVERLAY_MAX_MS,
  OVERLAY_SKEW_MS,
  cartTakenNote,
} from './archOrderOverlay.ts';
import { isLotLocked, reservationText } from './archLots.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', p), 'utf8');

/* ══ The poll ════════════════════════════════════════════════════════════ */

test('poll: reload only when the cache has something newer', () => {
  const m = (o) => Object.assign({ available: true, lastUpdated: '2026-09-23T15:30:00Z' }, o);
  assert.equal(pollVerdict('2026-09-23T15:30:00Z', true, m()), 'none', 'same build');
  assert.equal(pollVerdict('2026-09-23T15:15:00Z', true, m()), 'reload', 'newer build');
  assert.equal(pollVerdict('2026-09-23T15:45:00Z', true, m()), 'reload', 'INEQUALITY, not >: a reset still reloads');
  assert.equal(pollVerdict('x', true, m({ available: false })), 'none', 'cache missing: keep what is on screen');
  assert.equal(pollVerdict('x', true, m({ lastUpdated: '' })), 'none');
  assert.equal(pollVerdict(null, false, m()), 'reload', 'fixtures on screen and the cache answers: retry');
  assert.equal(pollVerdict('x', true, null), 'none');
  assert.equal(ARCH_POLL_MS, 30000);
});

test('poll: rate limits are recognised', () => {
  assert.equal(isRateLimited(new Error('SSS_REQUEST_LIMIT_EXCEEDED: too many')), true);
  assert.equal(isRateLimited(new Error('Request failed: 429')), true);
  assert.equal(isRateLimited(new Error('Request failed: 500')), false);
  assert.equal(isRateLimited(null), false);
});

test('poll wiring: ARCH\'s own meta, hidden tabs skipped, wizard holds it (source guards)', () => {
  const h = src('hooks/useArchSummaryData.ts');
  assert.match(h, /apiGet<ArchMetaPoll>\('meta', \{ subsidiaryId: ARCH_SUBSIDIARY_ID \}\)/, 'asks ARCH, never IND');
  assert.match(h, /document\.hidden\) return;/, 'a hidden tab does not poll');
  assert.match(h, /addEventListener\('visibilitychange'/, 'coming back checks at once');
  assert.match(h, /if \(subscribers\.size === 0\) return;/, 'idle when the ARCH view is not open');
  assert.match(h, /if \(refreshHeld\) \{\s*refreshPending = true;/, 'held while the wizard is open');
  assert.doesNotMatch(h, /useRefreshState/, 'never the shared IND/MTL hook');
  const s = src('components/ArchScreen.tsx');
  assert.match(s, /setArchAutoRefreshHeld\(wizardOpen\)/);
  assert.match(s, /addArchOrderOverlay\(overlayFromOrder\(draft\.lines, result, draft\.header\.customer, Date\.now\(\)\)\)/);
  // The overlay is added only on the success branch, after the cart is cleared.
  const ok = s.indexOf('if (result.ok) {');
  assert.ok(ok > 0 && s.indexOf('addArchOrderOverlay(', ok) > ok);
});

/* ══ The overlay ═════════════════════════════════════════════════════════ */

const NOW = Date.parse('2026-09-23T15:30:00Z');
const lines = [
  { lotId: '101', lotNo: '344950-1', isSplit: false },
  { lotId: '102', lotNo: '344950-2', isSplit: true },
  { lotId: '103', lotNo: '316027-12', isSplit: false },
];
const ok = { ok: true, salesOrderId: 5, tranId: 'SO-ARC-30' };

test('overlay: only a SAVED order marks anything', () => {
  assert.equal(overlayFromOrder(lines, ok, 'Bell', NOW).length, 3);
  assert.deepEqual(overlayFromOrder(lines, { ok: false, error: 'x' }, 'Bell', NOW), []);
  assert.deepEqual(overlayFromOrder(lines, { ok: false, transportFailure: true }, 'Bell', NOW), [], 'unknown outcome: nothing');
  assert.deepEqual(overlayFromOrder(lines, { ok: true }, 'Bell', NOW), [], 'no SO number: nothing');
  const e = overlayFromOrder(lines, ok, 'Bell', NOW);
  assert.deepEqual(e.map((x) => [x.lotNo, x.kind, x.soNumber]),
    [['344950-1', 'sold', 'SO-ARC-30'], ['344950-2', 'split', 'SO-ARC-30'], ['316027-12', 'sold', 'SO-ARC-30']]);
});

test('overlay: a bundle the server did not attribute is NOT marked', () => {
  const e = overlayFromOrder(lines, Object.assign({}, ok, {
    lotsNotAttributed: ['316027-12 (no saved line matched item PUR44KD at Prevost)'],
  }), 'Bell', NOW);
  assert.deepEqual(e.map((x) => x.lotNo), ['344950-1', '344950-2']);
  // A lot whose name is a PREFIX of another must not be caught by it.
  const e2 = overlayFromOrder([{ lotId: '9', lotNo: '344950-1' }],
    Object.assign({}, ok, { lotsNotAttributed: ['344950-12 (x)'] }), '', NOW);
  assert.equal(e2.length, 1);
});

const row = (lots) => ({ itemCode: 'PUR44KD', locationId: '151', lots });
const lot = (o) => Object.assign({ lotId: '101', lotNo: '344950-1', onHand: 0, inTransit: 100, onOrder: 0, reserve: 0, reservation: null }, o);

test('overlay: locks the bundle through the normal path, and never unlocks anything', () => {
  const entries = overlayFromOrder([lines[0]], ok, 'Bell', NOW);
  const rows = [row([lot(), lot({ lotId: '999', lotNo: 'other' })])];
  const out = applyOverlay(rows, entries);
  const marked = out[0].lots[0];
  assert.equal(marked.reservation.local, 'sold');
  assert.equal(isLotLocked(marked), true);
  assert.match(reservationText(marked).detail, /ordered just now from this screen/);
  assert.equal(out[0].lots[1], rows[0].lots[1], 'other bundles untouched, same object');
  const cached = { soId: '1', soNumber: 'SO-ARC-9', customer: 'X', pending: false, since: '', landed: false, exception: null };
  const already = [row([lot({ reservation: cached })])];
  assert.equal(applyOverlay(already, entries), already, 'a reservation the cache carries is never replaced');
  assert.equal(applyOverlay(rows, []), rows, 'no entries: the same array');
});

test('overlay: lets go when the cache answers, never before', () => {
  const entries = overlayFromOrder([lines[0]], ok, 'Bell', NOW);
  const stale = [row([lot()])];
  const before = new Date(NOW - 30 * 1000).toISOString();
  assert.equal(pruneOverlay(entries, stale, before, NOW + 60000).length, 1,
    'a rebuild that started BEFORE the order: keep');
  assert.equal(pruneOverlay(entries, stale, new Date(NOW + 30 * 1000).toISOString(), NOW + 120000).length, 1,
    'started 30 s after: inside the clock margin, keep');
  assert.equal(pruneOverlay(entries, stale, new Date(NOW + OVERLAY_SKEW_MS + 1000).toISOString(), NOW + 180000).length, 0,
    'started well after: the cache had its chance');
  const caught = [row([lot({ reservation: { soId: '5', soNumber: 'SO-ARC-30', customer: '', pending: false, since: '', landed: false, exception: null } })])];
  assert.equal(pruneOverlay(entries, caught, before, NOW + 60000).length, 0, 'payload shows it locked: drop');
  assert.equal(pruneOverlay(entries, null, null, NOW + OVERLAY_MAX_MS + 1).length, 0, 'expired');
  assert.equal(pruneOverlay(entries, null, null, NOW + 60000).length, 1, 'no payload yet: keep');
  // An on-hand bundle is shown sold once the cache carries the commitment.
  const sold = overlayFromOrder([{ lotId: '7', lotNo: '316027-7' }], ok, '', NOW);
  assert.equal(pruneOverlay(sold, [row([lot({ lotId: '7', onHand: 50, inTransit: 0 })])], before, NOW + 60000).length, 1, 'no commitment yet: keep');
  assert.equal(pruneOverlay(sold, [row([lot({ lotId: '7', onHand: 50, inTransit: 0, reserve: 50 })])], before, NOW + 60000).length, 0, 'commitment: drop');
});

test('cart: a bundle taken since it was added is named (review M1)', () => {
  const cart = [{ lotId: '101', lotNo: '344950-1' }, { lotId: '7', lotNo: '316027-7' }, { lotId: '8', lotNo: '316027-8' }];
  const other = { soId: '9', soNumber: 'SO-ARC-31', customer: '', pending: false, since: '', landed: false, exception: null };
  const rows = [row([
    lot({ reservation: other }),
    lot({ lotId: '7', lotNo: '316027-7', onHand: 50, inTransit: 0, reserve: 50 }),
    lot({ lotId: '8', lotNo: '316027-8', onHand: 50, inTransit: 0 }),
  ])];
  assert.equal(cartTakenNote(cart, rows),
    '2 bundles in the cart were taken since you added them: 344950-1 on SO-ARC-31, 316027-7 on another order. Remove them before ordering.');
  assert.equal(cartTakenNote([cart[2]], rows), '', 'still free: no note');
  // Still on the water and unreserved is NOT taken, and neither is this screen's own mark.
  assert.equal(cartTakenNote([{ lotId: '101', lotNo: '344950-1' }], [row([lot()])]), '');
  assert.equal(cartTakenNote([{ lotId: '101', lotNo: '344950-1' }], [row([lot({ reservation: Object.assign({}, other, { local: 'sold' }) })])]), '');
  assert.match(cartTakenNote([cart[2]], [row([lot({ lotId: '8', lotNo: '316027-8', onHand: 50, onHold: true })])]), /316027-8 on hold/);
  assert.equal(cartTakenNote(cart, null), '');
});

test('poll: backs off after ANY failure, and never re-fetches a build that failed (review M2, L4)', () => {
  const h = src('hooks/useArchSummaryData.ts');
  assert.match(h, /pollBackoffUntil = Date\.now\(\) \+ \(isRateLimited\(e\) \? ARCH_POLL_BACKOFF_MS : 60 \* 1000\);/);
  assert.match(h, /=== 'reload' && m\.lastUpdated !== failedBuild\)/);
  const s = src('components/ArchScreen.tsx');
  assert.match(s, /cartTakenNote\(cart, allRows\)/);
});
