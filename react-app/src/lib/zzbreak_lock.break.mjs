// D12: the fixture row now says Available where its own lots are all LOCKED,
// and the totals bar sums that number.
import { getArchFixtureRows } from './archFixtures.ts';
import { commitmentOn, isLotLocked } from './archLots.ts';

const rows = getArchFixtureRows();
let over = 0;
for (const r of rows) {
  const rtb = r.readyToBuild || 0;
  if (!rtb) continue;
  over += rtb;
  const selectable = r.lots.filter((l) => !isLotLocked(l))
    .reduce((s, l) => s + (l.onHand || 0), 0) + r.onOrder + r.inTransit;
  const freeBF = r.lots.reduce((s, l) => s + Math.max(0, (l.onHand || 0) - commitmentOn(l)), 0);
  console.log(r.itemCode + ' @ ' + r.locationName +
    ': grid Available=' + r.available +
    '  | drawer freeBF (onHand - commitmentOn) = ' + freeBF +
    '  | onHand on UNLOCKED lots = ' + (selectable - r.onOrder - r.inTransit) +
    '  | readyToBuild = ' + rtb);
}
const totalAvail = rows.reduce((s, r) => s + r.available, 0);
console.log('');
console.log('totals bar Available = ' + totalAvail + '  (overstated by ' + over +
            ' = ' + (100 * over / (totalAvail - over)).toFixed(1) + '% of the pre-fix figure)');
