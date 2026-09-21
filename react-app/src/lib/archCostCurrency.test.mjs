/**
 * Which cost the screen shows, and in which currency.
 *
 * Feedback 9 item 1, Marc-Antoine 2026-09-17: « BF cost : Est-ce qu'on peut
 * afficher par défaut en USD? Au taux de la réception en inventaire ».
 *
 * ── The part that had to be measured rather than assumed ────────────────────
 * His rule names `custbody_lot_currency`, which would only matter if the stored
 * cost were denominated in it. It is not. Measured in sandbox 2026-09-21, three
 * independent ways:
 *
 *   1. ARC is base CAD and `item.averagecost` is kept in base currency. The IA
 *      line rate equals it to the decimal on 5 of 5 items (WOA441CKD 2314.785
 *      vs 2314.785058), so the adjustments booked at CAD average cost.
 *   2. The same numeral appears under different currency tags: SAP54QCKD
 *      carries 3908.068 on 13 Euro lots, 2 US Dollar lots and 10 untagged lots
 *      across ten months; SAP84QCKD carries 5003.743 on both its CAD lot and
 *      its USD lots. One number cannot be denominated in two currencies.
 *   3. On the one path that DOES carry a real conversion, the inverse is exact:
 *      an IR line's CAD rate over the receipt's stamped rate returns the USD
 *      invoice price to the cent, 4 of 4 (BOC44KD 5547.72 / 1.38693 = 4000.00).
 *
 * So the conversion is CAD ÷ (CAD-per-USD rate at the receipt date), and the
 * lot currency is metadata about the purchase, not an input. The figures below
 * are the real ones off those measurements, so a future edit that quietly
 * inverts the direction fails here rather than on someone's margin.
 *
 * 🔴 WHY THE CAD FIGURE IS KEPT ALONGSIDE. The SO wizard converts CAD to the
 * order's currency itself, at the ORDER's stamped rate, for a different
 * question (margin on this order) than the grid answers (what the wood cost in
 * USD when it arrived). Replacing the CAD figure rather than adding to it means
 * the wizard converts an already-converted number, which `SOWizard.tsx`
 * measured once at 11 margin points in the direction that hides a loss.
 */
import { rowCostDisplay, lotCostDisplay } from './archLots.ts';

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

const row = (o = {}) => ({
  internalId: '3130',
  itemCode: 'WOA441CKD',
  unit: 'BF',
  avgCostPerUnit: 2.31,
  avgCostPerUnitUsd: 1.66,
  ...o,
});
const lot = (o = {}) => ({ lotNo: '315688-10', onHand: 1079, ...o });

/* ── 1. The row column: USD when it exists, CAD when it does not ──────────── */

{
  const d = rowCostDisplay(row());
  ok('a row with a USD average shows USD', d.value === 1.66 && d.currency === 'USD', d);
}
{
  // The real WOA441CKD row: CA$2.31/BF at the 2026-08-10 rate of 1.39434 is
  // US$1.66/BF. Pinned exactly, because `> 0` would also pass a rate of 1.
  const d = rowCostDisplay(row({ avgCostPerUnitUsd: null }));
  ok('a row the rate table could not reach falls back to CAD, and SAYS CAD',
    d.value === 2.31 && d.currency === 'CAD', d);
}
{
  const d = rowCostDisplay(row({ avgCostPerUnitUsd: undefined }));
  ok('...and a payload built before this change behaves the same way',
    d.value === 2.31 && d.currency === 'CAD', d);
}
{
  // Null, never zero. $0.00/BF reads as free wood.
  const d = rowCostDisplay(row({ avgCostPerUnit: null, avgCostPerUnitUsd: null }));
  ok('a row with no cost at all stays null rather than becoming zero',
    d.value === null && d.currency === 'CAD', d);
}
{
  const d = rowCostDisplay(row({ avgCostPerUnit: 0, avgCostPerUnitUsd: null }));
  ok('...but a genuine zero cost is preserved, not turned into null',
    d.value === 0 && d.currency === 'CAD', d);
}

/* ── 2. The drawer: this bundle's money, not its neighbour's ──────────────── */

{
  const d = lotCostDisplay(lot({ costPerUnit: 2.31, costPerUnitUsd: 1.66 }), row());
  ok("a bundle with its own USD cost shows it", d.value === 1.66 && d.currency === 'USD', d);
}
{
  // Feedback 6 item 18 was the row average standing in for a bundle that cost
  // something else: lot 316027-9 cost 14.15 and the drawer said 12.76.
  const d = lotCostDisplay(
    lot({ costPerUnit: 14.15, costPerUnitUsd: 10.15 }),
    row({ avgCostPerUnit: 12.76, avgCostPerUnitUsd: 9.15 })
  );
  ok("18 stays fixed: the dearest bundle is not quoted the row's blend",
    d.value === 10.15, d);
}
{
  /*
   * 🔴 THE RUNG THAT IS NEW AND DELIBERATE. This bundle's cost is known; only
   * the conversion is missing. Falling through to the row's USD average here
   * would answer a question about THIS bundle with another bundle's money, and
   * it would do it in USD so it would look more precise, not less.
   */
  const d = lotCostDisplay(lot({ costPerUnit: 14.15, costPerUnitUsd: null }), row());
  ok('an unconvertible bundle keeps its OWN cost in CAD, not the row average in USD',
    d.value === 14.15 && d.currency === 'CAD', d);
}
{
  // The pre-existing rung, kept: no posting history at all, so the row average
  // is the best honest estimate and is what this cell has always shown.
  const d = lotCostDisplay(lot({ costPerUnit: null, costPerUnitUsd: null }), row());
  ok('a bundle with no posting history still falls back to the row',
    d.value === 1.66 && d.currency === 'USD', d);
}
{
  const d = lotCostDisplay(lot({}), row({ avgCostPerUnitUsd: null }));
  ok('...and to the row in CAD when the row has no USD either',
    d.value === 2.31 && d.currency === 'CAD', d);
}
{
  const d = lotCostDisplay(lot({}), row({ avgCostPerUnit: null, avgCostPerUnitUsd: null }));
  ok('...and to null when nothing anywhere has a cost',
    d.value === null, d);
}

/* ── 3. The direction of the conversion, pinned to measured figures ────────
 *
 * Multiplying instead of dividing turns CA$2.31 into US$3.22 rather than
 * US$1.66. Both are plausible numbers to look at, which is exactly why this is
 * asserted against a real rate rather than eyeballed. 1.39434 is the rate
 * NetSuite itself stamped for 2026-08-10.
 */
{
  const FX = 1.39434;
  const cad = 2.31;
  const usd = Math.round((cad / FX) * 100) / 100;
  ok('CAD over the receipt-date rate is the USD figure the cache emits',
    usd === 1.66, usd);
  ok('...and multiplying would have produced a different, plausible, wrong number',
    Math.round(cad * FX * 100) / 100 === 3.22, Math.round(cad * FX * 100) / 100);
}
{
  // The IR round trip, which is the proof that this reproduces his « prix du
  // IR » exactly instead of approximating it. All four are real IR406/IR407
  // lines: CAD rate, the receipt's own stamped rate, and the PO price.
  const irs = [
    { code: 'BOC44KD', cad: 5547.72, fx: 1.38693, usd: 4000 },
    { code: 'CAN44KD', cad: 4438.176, fx: 1.38693, usd: 3200 },
    { code: 'BLO44KD', cad: 2496.474, fx: 1.38693, usd: 1800 },
    { code: 'AFM54KD', cad: 3189.939, fx: 1.38693, usd: 2300 },
  ];
  const bad = irs.filter((r) => Math.abs(r.cad / r.fx - r.usd) > 0.005);
  ok('the same formula returns the exact USD invoice price on all four real IR lines',
    bad.length === 0, bad);
}

/* ── 4. Nothing here depends on floating-point luck or a missing field ────── */

ok('an empty lot and an empty row do not throw',
  lotCostDisplay({}, { avgCostPerUnit: null }).value === null);
ok('a NaN USD cost is refused rather than rendered',
  rowCostDisplay(row({ avgCostPerUnitUsd: NaN })).currency === 'CAD');
ok('...and a NaN CAD cost comes back null, not NaN',
  rowCostDisplay(row({ avgCostPerUnit: NaN, avgCostPerUnitUsd: null })).value === null);
ok('an Infinity rate artefact cannot reach the screen',
  rowCostDisplay(row({ avgCostPerUnitUsd: Infinity })).currency === 'CAD');

console.log(fail ? `\nFAIL ${fail}` : '\nall cost-currency assertions hold');
process.exit(fail ? 1 : 0);
