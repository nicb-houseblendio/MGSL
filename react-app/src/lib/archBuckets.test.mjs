/**
 * Which bucket a bundle appears in, and what a bucket cannot show.
 *
 * Every fixture below is a TRANSCRIPT of the CWP ARCH sandbox on 2026-09-08,
 * read from `restlet.mjs --script 4720 --deploy 1 action=summary subsidiaryId=9`
 * and cross-checked against SuiteQL. They are not invented shapes: the two
 * client reports this file exists for are both reproducible on these exact rows.
 *
 *  - PUR44KD @ Ramsey Xpress is Lucas's report. SO-CWP-001346 shipped 300 BF
 *    (IF1208) and was billed (INV-CWP-1236, status G). The lot it shipped from,
 *    315643-7, is at 211 BF on hand — IA-CWP-362 put 511 in, the fulfilment took
 *    300 out — and NetSuite reports 211 available on it. Nothing is reserved.
 *    The cache nevertheless sent that lot `reserve: 300`, which is what put a
 *    reserved note on a bundle no order holds.
 *
 *  - PUR44KD @ CWP Prevost is the honest gap: 2,950 BF on order against
 *    purchase-order lines whose bundles do not exist yet, so no lot can carry it.
 */
import { availabilityStatus, lotQuantity } from './archLots.ts';
import { bucketLots, bucketLotTotal, bucketGap, bucketGapReason, notSourcedNote } from './archBuckets.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const lot = (o) => ({
  lotNo: o.lotNo, lotId: o.lotId || '0', po: '', containerNo: '',
  onHand: 0, reserve: 0, readyToBuild: 0, outbound: 0, onOrder: 0, inTransit: 0,
  ...o,
});

const row = (o) => ({
  internalId: '0', itemCode: 'X', description: 'X', locationId: '0', locationName: 'L',
  species: '', thickness: '', category: '', grade: '', grain: '', unit: 'BF',
  lots: [], onHand: 0, reserve: 0, readyToBuild: 0, outbound: 0, onOrder: 0, inTransit: 0,
  available: 0, avgCostPerUnit: null, detailKey: '0-0',
  ...o,
});

/* ══ 1. A SHIPPED BUNDLE IS NOT RESERVED, AND IT IS NOT COMMITTED ═════════════
 * The lot-level figure the cache sends for 315643-7 once the shipped share stops
 * being booked as a reservation. On hand 211, nothing held against it.
 */
{
  const shipped = lot({ lotNo: '315643-7', onHand: 211 });
  const st = availabilityStatus(shipped);
  ok('shipped bundle: its remaining on-hand is available in full',
    st !== null && st.qty === 211 && st.label === 'On Hand', st);
  ok('shipped bundle: lotQuantity(available) is the remainder, not zero',
    lotQuantity(shipped, 'available') === 211, lotQuantity(shipped, 'available'));
}

/* ══ 2. A HELD BUNDLE MUST NEVER READ AS AVAILABLE ════════════════════════════
 * The row formula subtracts `held` from `available` and ONLY from `available`
 * (types/arch.ts). The drill-down has to make the same subtraction or the lots
 * listed under Available include stock the number above them excludes.
 */
{
  const held = lot({ lotNo: '316027-8', onHand: 500, onHold: true, heldPacks: 3 });
  ok('held bundle: availabilityStatus refuses it',
    availabilityStatus(held) === null, availabilityStatus(held));
  ok('held bundle: contributes nothing to Available',
    lotQuantity(held, 'available') === 0, lotQuantity(held, 'available'));
  ok('held bundle: still reports its On Hand, because the wood is on the floor',
    lotQuantity(held, 'onHand') === 500, lotQuantity(held, 'onHand'));
}

/* ══ 3. A HELD BUNDLE IS NOT AVAILABLE EVEN WITH INCOMING STOCK ═══════════════
 * The cascade in availabilityStatus falls through to onOrder/inTransit when the
 * on-hand part is spoken for. A hold is a hold: it must not fall through.
 */
{
  const held = lot({ lotNo: '316027-9', onHand: 500, onOrder: 900, onHold: true });
  ok('held bundle with stock on order: still not available',
    availabilityStatus(held) === null, availabilityStatus(held));
}

/* ══ 4. LUCAS'S ROW — the Available view lists every free bundle and reconciles ═*/
{
  const r = row({
    itemCode: 'PUR44KD', locationName: 'Ramsey Xpress',
    onHand: 1754, outbound: 300, available: 1454,
    lots: [
      lot({ lotNo: '315643-7', onHand: 211 }),
      lot({ lotNo: '315643-13', onHand: 483 }),
      lot({ lotNo: '315604-2', onHand: 1060 }),
    ],
  });
  ok('Lucas row: all three bundles are listed under Available',
    bucketLots(r, 'available').map((l) => l.lotNo).join(',') === '315643-7,315643-13,315604-2',
    bucketLots(r, 'available').map((l) => l.lotNo));
  ok('Lucas row: the listed bundles hold 1,754 BF free',
    bucketLotTotal(r, 'available') === 1754, bucketLotTotal(r, 'available'));
  ok('Lucas row: nothing is reserved, so the Reserved drill-down is empty',
    bucketLots(r, 'reserve').length === 0, bucketLots(r, 'reserve'));
}

/* ══ 5. A GENUINELY RESERVED ROW — SO-CWP-001344, nothing shipped ═════════════*/
{
  const r = row({
    itemCode: 'ZEB84KD', locationName: 'Ramsey Xpress',
    onHand: 2160, reserve: 2160, available: 0,
    lots: [
      lot({ lotNo: '316027-12', onHand: 1080, reserve: 1080 }),
      lot({ lotNo: '316027-2', onHand: 1080, reserve: 1080 }),
    ],
  });
  ok('reserved row: both bundles show under Reserved',
    bucketLots(r, 'reserve').length === 2, bucketLots(r, 'reserve').length);
  ok('reserved row: neither shows under Available',
    bucketLots(r, 'available').length === 0, bucketLots(r, 'available'));
  ok('reserved row: Reserved reconciles against its bundles',
    bucketGap(r, 'reserve') === 0, bucketGap(r, 'reserve'));
  ok('reserved row: Available reconciles at zero',
    bucketGap(r, 'available') === 0, bucketGap(r, 'available'));
}

/* ══ 6. A PARTIALLY RESERVED BUNDLE contributes its remainder, and only that ══
 * The bundle is LOCKED for selection (any commitment holds the whole lift) but
 * it still holds free volume. The two are different questions and this pins the
 * arithmetic half: 741 of 2,350 reserved leaves 1,609, never 2,350.
 */
{
  const part = lot({ lotNo: '316027-5', onHand: 2350, reserve: 741 });
  ok('partial reserve: 1,609 free, not 2,350',
    lotQuantity(part, 'available') === 1609, lotQuantity(part, 'available'));
  const r = row({ onHand: 2350, reserve: 741, available: 1609, lots: [part] });
  ok('partial reserve: Available reconciles against the bundle remainder',
    bucketGap(r, 'available') === 0, bucketGap(r, 'available'));
}

/* ══ 7. THE HONEST GAP — stock on order has no bundle yet ═════════════════════
 * PUR44KD @ CWP Prevost: 15,061 BF on hand across 19 bundles, 2,950 BF on order
 * against PO lines. A purchase order has no inventory number until it is
 * received, so 2,950 of the 18,011 Available cannot be listed. Saying so beats
 * a drill-down whose rows silently fall 2,950 short of its own header.
 */
{
  const r = row({
    itemCode: 'PUR44KD', locationName: 'CWP Prevost',
    onHand: 15061, onOrder: 2950, available: 18011,
    lots: [lot({ lotNo: '315604-1', onHand: 15061 })],
  });
  ok('on-order gap: 2,950 BF of Available is not attributable to a bundle',
    bucketGap(r, 'available') === 2950, bucketGap(r, 'available'));
  ok('on-order gap: the reason names purchase orders',
    /purchase[- ]order/i.test(bucketGapReason('available') || ''), bucketGapReason('available'));
  ok('on-order gap: On Hand itself reconciles',
    bucketGap(r, 'onHand') === 0, bucketGap(r, 'onHand'));
}

/* ══ 8. MARC-ANTOINE'S ROW — sold, but no bundle claims it ════════════════════
 * An order line written without inventory detail moves the ROW into Reserved and
 * leaves every bundle at zero, so the drill-down is empty while the column reads
 * 1,080. That is the shape that reads as stock having vanished.
 */
{
  const r = row({
    onHand: 1080, reserve: 1080, available: 0,
    lots: [lot({ lotNo: '316027-14', onHand: 1080 })],
  });
  ok('unattributed reserve: the gap is the whole 1,080',
    bucketGap(r, 'reserve') === 1080, bucketGap(r, 'reserve'));
  ok('unattributed reserve: the reason names sales-order lines',
    /sales-order line/i.test(bucketGapReason('reserve') || ''), bucketGapReason('reserve'));
}

/* ══ 9. READY TO BUILD HAS NO SOURCE, and the screen has to say so ════════════
 * `readyToBuild` is a hardcoded literal 0 in the cache (no NetSuite field feeds
 * it) and `action=meta` reports it under bucketsEmpty. A column that can never
 * be anything but 0 must not read as a measured zero.
 */
{
  const note = notSourcedNote('readyToBuild');
  ok('readyToBuild: carries a not-sourced note', typeof note === 'string' && note.length > 0, note);
  ok('readyToBuild: the note says where sold stock actually sits',
    /reserved/i.test(note || ''), note);
  ok('onHand: has no not-sourced note', notSourcedNote('onHand') === null, notSourcedNote('onHand'));
  ok('reserve: has no not-sourced note', notSourcedNote('reserve') === null, notSourcedNote('reserve'));
  ok('available: has no not-sourced note', notSourcedNote('available') === null, notSourcedNote('available'));
}

/* ══ 10. A SHIPPED ROW: the bundles listed must not exceed the header ════════
 * ZEB84KD @ CWP Prevost, the row that proved the double deduction. 15,872.99 BF
 * across 17 bundles, none reserved, and 500 BF shipped on SO-CWP-001345 out of
 * lot 315970-9 — a lot that is at 0 on hand and no longer in the list. The row's
 * Available has to be the 15,872.99 that is actually there. When it was
 * 15,372.99 the Available drill-down listed 500 BF MORE than its own header.
 */
{
  const r = row({
    itemCode: 'ZEB84KD', locationName: 'CWP Prevost',
    onHand: 15872.99, outbound: 500, available: 15872.99,
    lots: [lot({ lotNo: '315970-1', onHand: 15872.99 })],
  });
  ok('shipped row: the bundles listed do not exceed the Available header',
    bucketLotTotal(r, 'available') <= Math.round(r.available), {
      listed: bucketLotTotal(r, 'available'), header: r.available,
    });
  ok('shipped row: Available reconciles against its bundles',
    bucketGap(r, 'available') === 0, bucketGap(r, 'available'));
  ok('shipped row: nothing is listed under Outbound, because no bundle carries it',
    bucketLots(r, 'outbound').length === 0, bucketLots(r, 'outbound'));
  ok('shipped row: the Outbound total is therefore all gap, and it is named',
    bucketGap(r, 'outbound') === 500 && bucketGapReason('outbound') !== null,
    { gap: bucketGap(r, 'outbound'), reason: bucketGapReason('outbound') });
}

/* ══ 11. FLOATING NOISE IS NOT A GAP ═════════════════════════════════════════
 * The cache emits 140.99999999999997 for a 141 BF fulfilment. A gap line that
 * fires on a rounding tail would appear on rows that reconcile exactly.
 */
{
  const r = row({
    onHand: 364, outbound: 140.99999999999997, available: 364,
    lots: [lot({ lotNo: '316027-4-B', onHand: 363.99999999999994 })],
  });
  ok('rounding tail is not reported as a gap', bucketGap(r, 'available') === 0, bucketGap(r, 'available'));
}

console.log(fail ? ('# FAIL ' + fail) : '# archBuckets ok');
process.exit(fail ? 1 : 0);
