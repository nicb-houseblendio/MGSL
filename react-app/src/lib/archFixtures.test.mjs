// The fixture Available formula, tested against the LOTS rather than against itself.
//
// ⚠️ THIS FILE'S FIRST VERSION WAS THE DEFECT. On 2026-09-08 it asserted that
// `available` ignores `readyToBuild`, which is what the change it shipped with had
// just made true. It pinned an assumption, not a behaviour, and its own comment
// admitted the premise did not hold ("the row sum is stock that is NOT reserved").
// Both were reverted the same day. The rule below is the one the app actually
// enforces, so these assertions can fail if either side drifts:
//
//   available = onHand + onOrder + inTransit - reserve - readyToBuild - outbound
//
// and, the check that would have caught the bad change immediately, a row can never
// report more Available than its own lots have free.
import { getArchFixtureRows } from './archFixtures.ts';
import { commitmentOn, isLotLocked } from './archLots.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const rows = getArchFixtureRows();
const lotFree = (l) => Math.max(0, (l.onHand || 0) + (l.onOrder || 0) + (l.inTransit || 0) - commitmentOn(l));

ok('fixtures produce rows at all', rows.length > 0, rows.length);

const rtb = rows.filter((r) => (r.readyToBuild || 0) > 0);
ok('some rows carry a nonzero readyToBuild, else these assertions prove nothing', rtb.length > 0, rtb.length);

// 1. the formula, stated once
for (const r of rows) {
  const expected = Math.max(0, r.onHand + r.onOrder + r.inTransit - r.reserve - r.readyToBuild - r.outbound);
  if (r.available !== expected) {
    ok(r.itemCode + ' @ ' + r.locationName + ': available subtracts all three commitments',
      false, { available: r.available, expected, reserve: r.reserve, readyToBuild: r.readyToBuild, outbound: r.outbound });
  }
}
ok('every row: available = onHand + onOrder + inTransit - reserve - readyToBuild - outbound',
  rows.every((r) => r.available === Math.max(0, r.onHand + r.onOrder + r.inTransit - r.reserve - r.readyToBuild - r.outbound)));

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

console.log(fail ? ('# FAIL ' + fail) : '# archFixtures ok');
process.exit(fail ? 1 : 0);
