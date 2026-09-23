/**
 * Which bundles a trader may put on a sales order.
 *
 * `isLotLocked` is the single predicate behind every selection gate in
 * `ArchLotTable`: the row checkbox, select-all, the Add to SO re-filter, the
 * disabled state of the button, and the "nothing sellable" notice. Getting it
 * wrong in the permissive direction means offering wood that cannot be sold.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * On 2026-09-17 the cache's lot universe was widened to admit bundles that are
 * minted on an open purchase order and hold ZERO stock, so Marc-Antoine's On
 * Order drill-down could list them. He asked for exactly that, and for the other
 * half in the same breath: « Il faudrait présenter l'information, mais ne pas
 * être capable de sélectionner des lots pour générer un SO. »
 *
 * Presenting them and not selling them are two different changes. The predicate
 * was `commitmentOn(lot) > 0`, which is blind to whether the wood exists, so the
 * new bundles read as sellable. They would not have shown under On Hand, which
 * filters on the bucket quantity, but they WOULD have shown under Available,
 * which is sellable and whose cascade has an On Order rung.
 *
 * 🔴 AND THE FIRST ATTEMPT AT THE FIX WAS A REGRESSION. Rewriting the predicate
 * as `sellableOn(lot) <= 0` reads like a tidy-up and silently UNLOCKS every
 * partially reserved bundle: a 690 BF bundle with 300 reserved has 390 free, so
 * it would have become sellable, which is the opposite of the rule ARCH has
 * always enforced. It is an OR of two independent rules, not one arithmetic
 * test, and section 3 below is the assertion that says so.
 */
import { commitmentOn, sellableOn, hasArrived, isLotLocked, lockReason, availabilityStatus, lotQuantity } from './archLots.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const lot = (o) => ({
  lotNo: 'L', onHand: 0, reserve: 0, readyToBuild: 0, outbound: 0,
  onOrder: 0, inTransit: 0, ...o,
});

// ── 1. The case Marc-Antoine reported ───────────────────────────────────────
// Lot 001326-2 as the cache actually emits it, measured 2026-09-17: on the
// unreceived PO-CWP-001326 at Bluelinx, 3,000 BF on order, nothing on hand.
const onOrderBundle = lot({ lotNo: '001326-2', onHand: 0, onOrder: 3000 });

ok('an on-order bundle has not arrived', !hasArrived(onOrderBundle));
ok('🔴 an on-order bundle CANNOT be put on a sales order', isLotLocked(onOrderBundle));
ok('...and it carries no commitment, so the OLD predicate would have allowed it',
  commitmentOn(onOrderBundle) === 0);
ok('...which is the whole point: commitment alone is not the question',
  commitmentOn(onOrderBundle) === 0 && isLotLocked(onOrderBundle));
ok('the lock explains itself rather than showing a bare disabled box',
  lockReason(onOrderBundle)?.badge === 'Ord', lockReason(onOrderBundle));
ok('the reason names the quantity and says it has not been received',
  /3000 BF/.test(lockReason(onOrderBundle).detail) &&
  /not yet received/.test(lockReason(onOrderBundle).detail),
  lockReason(onOrderBundle).detail);

/* It must still be VISIBLE. He asked to see it, not to have it hidden.
 *
 * 🔴 CHANGED 2026-09-22, and the change is client-visible. These two used to
 * assert the bundle was listed under AVAILABLE at its full incoming quantity.
 * On 2026-09-22 `onOrder` left the Available formula on the server, because he
 * said on order is visibility only and he sells from in transit. A lot list
 * that still offered on-order bundles under a header that no longer counts
 * them would disagree with itself by 42,605 BF.
 *
 * So visibility moved rather than went away, and these assertions now pin
 * WHERE: the On Order column, the On Order drill-down, and the badge. If a
 * future change hides an on-order bundle from all three, that breaks his
 * instruction and one of these fails.
 */
ok('an on-order bundle is NO LONGER listed under Available',
  availabilityStatus(onOrderBundle) === null,
  availabilityStatus(onOrderBundle));
ok('🔴 but it is still visible, which is what he actually asked for: it keeps its quantity',
  onOrderBundle.onOrder === 3000);
ok('...and it still reports itself as on order through the lock reason',
  lockReason(onOrderBundle)?.badge === 'Ord');
ok('...listed at its full incoming quantity under the On Order bucket',
  lotQuantity(onOrderBundle, 'onOrder') === 3000);

const inTransitBundle = lot({ onHand: 0, inTransit: 500 });
ok('an in-transit bundle is locked on the same rule', isLotLocked(inTransitBundle));
ok('...with its own badge, not the on-order one',
  lockReason(inTransitBundle)?.badge === 'Trns', lockReason(inTransitBundle));

// ── 2. Ordinary arrived stock is unaffected ─────────────────────────────────
const clean = lot({ onHand: 690 });
ok('a bundle in the yard with no commitment is sellable', !isLotLocked(clean));
ok('...and has nothing to explain', lockReason(clean) === null);
ok('its sellable quantity is its on-hand', sellableOn(clean) === 690);

// ── 3. 🔴 THE PARTIAL-COMMITMENT LOCK, which a "net sellable" rewrite breaks ──
// A bundle is the unit that ships, so a trader must not sell round the part
// somebody else claimed. 390 BF is genuinely free here and it is STILL locked.
const partial = lot({ onHand: 690, reserve: 300 });
ok('🔴 a PARTIALLY reserved bundle is locked in full', isLotLocked(partial));
ok('...even though 390 BF is arithmetically free', sellableOn(partial) === 390);
ok('...and it says which order stage holds it', lockReason(partial)?.badge === 'Rsvd', lockReason(partial));

const partialBuild = lot({ onHand: 690, readyToBuild: 120 });
ok('readyToBuild locks the same way reserve does', isLotLocked(partialBuild));
ok('...with the build badge, not the reserved one',
  lockReason(partialBuild)?.badge === 'Bld', lockReason(partialBuild));

// ── 4. Outbound IS a commitment since Feedback 10 ───────────────────────────
// It used to be shipped wood, and counting it was wrong. For ARC it is now the
// share of an order ticked Ready to Ship: still on the bundle, still sold.
const shipped = lot({ onHand: 400, outbound: 300 });
ok('a bundle on an order ticked Ready to Ship is locked, like any claimed bundle',
  isLotLocked(shipped));
ok('...because outbound now counts as a commitment', commitmentOn(shipped) === 300);
ok('...and it says why', lockReason(shipped)?.badge === 'Out', lockReason(shipped));

// ── 5. Totality: anything locked can say why ────────────────────────────────
// A disabled checkbox with no badge beside it reads as a broken screen.
const everyShape = [
  onOrderBundle, inTransitBundle, clean, partial, partialBuild, shipped,
  lot({ onHand: 0 }),                                  // dead lot, no stock anywhere
  lot({ onHand: 0, onOrder: 10, reserve: 4 }),         // incoming AND claimed
  lot({ onHand: 100, reserve: 100 }),                  // fully reserved
];
for (const l of everyShape) {
  if (isLotLocked(l)) {
    ok(`a locked bundle always has a reason (${JSON.stringify({ onHand: l.onHand, onOrder: l.onOrder, inTransit: l.inTransit, reserve: l.reserve, readyToBuild: l.readyToBuild })})`,
      lockReason(l) !== null, l);
  }
}
ok('a bundle with nothing anywhere is locked, and says so',
  isLotLocked(lot({ onHand: 0 })) && lockReason(lot({ onHand: 0 }))?.badge === 'None');
ok('an incoming bundle that is ALSO claimed reports the CLAIM, the more useful fact',
  lockReason(lot({ onHand: 0, onOrder: 10, reserve: 4 }))?.badge === 'Rsvd',
  lockReason(lot({ onHand: 0, onOrder: 10, reserve: 4 })));

// ── 6. A held lot is never sellable and never available ─────────────────────
const held = lot({ onHand: 500, onHold: true });
ok('an on-hold bundle reports no availability at all', availabilityStatus(held) === null);
ok('an on-hold bundle with incoming stock does not come back by another name',
  availabilityStatus(lot({ onHand: 0, onOrder: 900, onHold: true })) === null);

// ── 7. Nothing here depends on floating-point luck ──────────────────────────
ok('a bundle whose commitment exactly equals its on-hand is locked',
  isLotLocked(lot({ onHand: 0.1 + 0.2, reserve: 0.3 })));
ok('missing fields are treated as zero, not NaN', !isLotLocked({ lotNo: 'X', onHand: 5 }));
ok('...and an empty lot object is locked rather than throwing', isLotLocked({ lotNo: 'X' }));

console.log(fail ? `\nFAIL ${fail}` : '\nall sellability assertions hold');
process.exit(fail ? 1 : 0);
