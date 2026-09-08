// Regression for the fixture Available formula. Ready to Build is a status on
// reserved stock (decided 2026-08-19), so it must not be deducted a second time.
// Before the fix the row formula subtracted it, understating Available on every row
// whose lots carried a nonzero readyToBuild, on the path that paints first and
// persists whenever the RESTlet is down. The live cache subtracts a literal 0 for it.
import { getArchFixtureRows } from './archFixtures.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const rows = getArchFixtureRows();
const rtb = rows.filter((r) => (r.readyToBuild || 0) > 0);

ok('fixtures still generate rows with a nonzero readyToBuild (else this test proves nothing)', rtb.length > 0, rtb.length);
for (const r of rtb) {
  const expected = Math.max(0, r.onHand + r.onOrder + r.inTransit - r.reserve - r.outbound);
  ok(r.itemCode + ' @ ' + r.locationName + ': available ignores readyToBuild', r.available === expected, { available: r.available, expected, readyToBuild: r.readyToBuild });
}
// The lot generator never gives a reserved lot a readyToBuild figure, so the row sum is
// stock that is NOT reserved. Under the settled semantics that cannot happen live (Ready
// to Build is a state OF a reservation); the fixture keeps it only to exercise the column.
ok('row readyToBuild is the sum of its lots', rtb.every((r) => r.readyToBuild === r.lots.reduce((s, l) => s + (l.readyToBuild || 0), 0)));

console.log(fail ? ('# FAIL ' + fail) : '# archFixtures ok');
process.exit(fail ? 1 : 0);
