// The fixture Available formula, tested against the LOTS rather than against itself.
//
// ⚠️ THIS FILE'S FIRST VERSION WAS THE DEFECT. On 2026-09-08 it asserted that
// `available` ignores `readyToBuild`, which is what the change it shipped with had
// just made true. It pinned an assumption, not a behaviour, and its own comment
// admitted the premise did not hold ("the row sum is stock that is NOT reserved").
// Both were reverted the same day. The rule below is the one the app actually
// enforces, so these assertions can fail if either side drifts:
//
//   available = onHand - reserve - readyToBuild - outbound
// (Feedback 10: outbound is Ready to Ship wood, still on hand, so it IS a claim.
//  Before that it was shipped wood and was not subtracted.)
//
// and, the check that would have caught the bad change immediately, a row can never
// report more Available than its own lots have free.
import { getArchFixtureRows } from './archFixtures.ts';
import { commitmentOn, isLotLocked } from './archLots.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const rows = getArchFixtureRows();
/* 🔴 `onOrder` LEFT THIS ON 2026-09-22, at the same time as the row formula.
 *
 * This is the LOT side of invariant 3 below, which asserts a row's Available
 * equals the free volume of its own lots exactly. The row formula in
 * `archFixtures.ts` and the cache builder both stopped counting on-order wood
 * that day, so leaving it here would turn an equality that holds into an
 * assertion that the two sides disagree. It mirrors `availabilityStatus` in
 * `archLots.ts`, which lost its On Order rung in the same commit.
 *
 * 🔴 IN TRANSIT LEFT BOTH SIDES TOO, later the same day. The client does call
 * in-transit wood sellable and this code cannot sell it: `isLotLocked` refuses any
 * bundle with no yard stock and the server refuses it again, so counting it in
 * Available offered volume no trader could put on an order.
 */
const lotFree = (l) => Math.max(0, (l.onHand || 0) - commitmentOn(l));

ok('fixtures produce rows at all', rows.length > 0, rows.length);

const rtb = rows.filter((r) => (r.readyToBuild || 0) > 0);
ok('some rows carry a nonzero readyToBuild, else these assertions prove nothing', rtb.length > 0, rtb.length);

// 1. the formula, stated once
for (const r of rows) {
  const expected = Math.max(0, r.onHand - r.reserve - r.readyToBuild - r.outbound);
  if (r.available !== expected) {
    ok(r.itemCode + ' @ ' + r.locationName + ': available subtracts all three commitments',
      false, { available: r.available, expected, reserve: r.reserve, readyToBuild: r.readyToBuild, outbound: r.outbound });
  }
}
ok('every row: available = onHand - reserve - readyToBuild - outbound, WITHOUT onOrder or inTransit',
  rows.every((r) => r.available === Math.max(0, r.onHand - r.reserve - r.readyToBuild - r.outbound)));
ok('🔴 and a row whose only stock is in transit reports Available 0',
  rows.filter((r) => (r.inTransit || 0) > 0 && (r.onHand || 0) === 0)
      .every((r) => r.available === 0));
// 🔴 Directional, so the guard cannot pass by reverting. On order must be ABSENT
// from Available, not merely absent from this line: a fixture that still added it
// would fail the equality above but a text-only guard would not notice.
ok('🔴 and a row with on-order wood and nothing else reports Available 0',
  rows.filter((r) => (r.onOrder || 0) > 0 && (r.onHand || 0) === 0 && (r.inTransit || 0) === 0)
      .every((r) => r.available === 0));

// 2. THE CHECK THAT CATCHES A WRONG FORMULA: a row cannot offer more than its lots hold.
const over = rows
  .map((r) => ({ r, free: r.lots.reduce((s, l) => s + lotFree(l), 0) }))
  .filter(({ r, free }) => r.available > free + 1e-9);
ok('no row reports more Available than the sum of its own lots have free',
  over.length === 0,
  over.map(({ r, free }) => ({ item: r.itemCode, loc: r.locationName, available: r.available, lotsFree: free, over: r.available - free })));

// 3. THE INVARIANT, stated as an equality. A row's Available is exactly the free
//    volume of its lots. NOTE this is deliberately NOT "a locked bundle contributes
//    nothing": isLotLocked governs whether a trader may SELECT a bundle, and a
//    PARTIALLY reserved bundle is locked for selection while still holding free
//    volume. Conflating the two would assert something false.
const mismatch = rows
  .map((r) => ({ r, free: r.lots.reduce((s, l) => s + lotFree(l), 0) }))
  .filter(({ r, free }) => Math.abs(r.available - free) > 1e-9);
ok('every row: Available equals the free volume of its own lots, exactly',
  mismatch.length === 0,
  mismatch.map(({ r, free }) => ({ item: r.itemCode, loc: r.locationName, available: r.available, lotsFree: free, delta: r.available - free })));

// 4. the row aggregate agrees with its lots, per bucket
for (const k of ['onHand', 'reserve', 'readyToBuild', 'outbound', 'onOrder', 'inTransit']) {
  ok('row ' + k + ' is the sum of its lots',
    rows.every((r) => Math.abs(r[k] - r.lots.reduce((s, l) => s + (l[k] || 0), 0)) < 1e-9));
}

// 5. the generator's own shape, recorded because the reverted change depended on it
ok('the generator keeps readyToBuild and reserve DISJOINT (why "already inside reserve" was false)',
  rows.every((r) => r.lots.every((l) => !((l.readyToBuild || 0) > 0 && (l.reserve || 0) > 0))),
  rows.flatMap((r) => r.lots.filter((l) => (l.readyToBuild || 0) > 0 && (l.reserve || 0) > 0).map((l) => l.lotNo)));

// 6. Feedback 10: outbound is a Ready to Ship claim on wood STILL on the lot, so it
//    must fit inside onHand, be disjoint from the other two claims, and lock.
{
  const ready = rows.flatMap((r) => r.lots.filter((l) => (l.outbound || 0) > 0));
  ok('some lots carry a Ready to Ship quantity, else this proves nothing', ready.length > 0, ready.length);
  ok('a Ready to Ship claim never exceeds the wood on the lot',
    ready.every((l) => (l.outbound || 0) <= (l.onHand || 0) + 1e-9),
    ready.filter((l) => (l.outbound || 0) > (l.onHand || 0)).map((l) => l.lotNo));
  ok('Ready to Ship is disjoint from Reserved and Ready to Build on a lot',
    ready.every((l) => !(l.reserve || 0) && !(l.readyToBuild || 0)),
    ready.filter((l) => (l.reserve || 0) || (l.readyToBuild || 0)).map((l) => l.lotNo));
  ok('a Ready to Ship bundle is locked out of selling', ready.every((l) => isLotLocked(l)));
  ok('the fixture formula matches the ARCH cache formula: outbound in, on order and in transit out',
    rows.every((r) => r.available === Math.max(0, r.onHand - r.reserve - r.readyToBuild - r.outbound)));
}

console.log(fail ? ('# FAIL ' + fail) : '# archFixtures ok');
process.exit(fail ? 1 : 0);
