// DEFECT PROBE (not part of npm test): does the new fixture Available formula
// agree with the LOT numbers the same fixtures generate?
import { getArchFixtureRows } from './archFixtures.ts';

const rows = getArchFixtureRows();
let bad = 0;
console.log('rows: ' + rows.length);
for (const r of rows) {
  const lotNet = r.lots.reduce(
    (s, l) => s + Math.max(0, (l.onHand || 0) - (l.reserve || 0) - (l.readyToBuild || 0) - (l.outbound || 0)), 0)
    + r.onOrder + r.inTransit;
  if (r.available !== lotNet) {
    bad++;
    console.log(
      'MISMATCH ' + r.itemCode + ' @ ' + r.locationName +
      '  row.available=' + r.available + '  sum(lot net)=' + lotNet +
      '  over-stated by ' + (r.available - lotNet) +
      '  [onHand=' + r.onHand + ' reserve=' + r.reserve + ' rtb=' + r.readyToBuild + ' out=' + r.outbound + ']');
  }
}
// Is readyToBuild ever inside reserve in the fixtures? (the premise of the fix)
const overlap = rows.flatMap((r) => r.lots).filter((l) => l.readyToBuild > 0 && l.reserve > 0);
console.log('lots where readyToBuild and reserve overlap (the fix assumes ALL do): ' + overlap.length);
const rtbLots = rows.flatMap((r) => r.lots).filter((l) => l.readyToBuild > 0);
console.log('lots with readyToBuild > 0: ' + rtbLots.length + ', of which reserve === 0: ' +
  rtbLots.filter((l) => !l.reserve).length);
console.log(bad ? ('# ROWS WHOSE AVAILABLE EXCEEDS THEIR OWN LOTS: ' + bad) : '# consistent');
