/**
 * What a bucket's drill-down can show, and what it cannot.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Two client reports on 2026-09-08, both about which bucket stock appears in:
 *
 *   Lucas: "When there is material reserved it shows in the 'available' with a
 *   note on it even when reserved toggle is off. Shows again when toggled on."
 *
 *   Marc-Antoine: "quand je crée un SO ça devrait aller dans ready to build ou
 *   dans reserved mais en ce moment on dirait qu'il fait juste disparaitre du TS."
 *
 * Both land on the same structural gap: a ROW total and the LOTS underneath it
 * come from different places. Row buckets are summed from the order LINES, so
 * they are complete; per-lot buckets exist only where a line carries an
 * inventory-detail assignment, so they can be short. Where they disagree, the
 * old drill-down printed a header total and a list of bundles that did not add
 * up to it and said nothing — which reads as stock having gone missing.
 *
 * Nothing here invents a quantity. It reports the difference and names the one
 * reason it can arise, so the trader can tell a data gap from a bug.
 */

import type { ArchSummaryRow, ArchLot, ArchDetailKey } from '@/types/arch';
import { lotQuantity } from '@/lib/archLots';

/**
 * Bundles a bucket's drill-down lists: every lot carrying a quantity in it.
 *
 * Nothing is hidden, including bundles that cannot be sold — the lock badge on
 * the row says why. Hiding them made the visible lots fall short of the header
 * total, which is the same failure this module exists to surface.
 */
export const bucketLots = (row: ArchSummaryRow, bucket: ArchDetailKey): ArchLot[] =>
  row.lots.filter((l) => lotQuantity(l, bucket) > 0);

/** What those bundles add up to. */
export const bucketLotTotal = (row: ArchSummaryRow, bucket: ArchDetailKey): number =>
  row.lots.reduce((s, l) => s + lotQuantity(l, bucket), 0);

/**
 * Quantity in this bucket that NO bundle claims.
 *
 * Rounded on both sides before subtracting, and reported only at a whole unit or
 * more. The cache emits `140.99999999999997` for a 141 BF fulfilment — a raw
 * subtraction would put a gap notice on rows that reconcile exactly.
 *
 * Floored at 0: a negative would mean the lots claim MORE than the row, which is
 * a different fault (double-booked attribution) and not something a note about
 * missing detail should be asked to describe.
 */
export const bucketGap = (row: ArchSummaryRow, bucket: ArchDetailKey): number =>
  Math.max(0, Math.round(row[bucket] ?? 0) - Math.round(bucketLotTotal(row, bucket)));

/**
 * The one reason a gap can arise, per bucket.
 *
 * Deliberately a cause, not an instruction. An order line without inventory
 * detail, or a purchase order whose goods do not exist yet, contributes a real
 * and correct quantity to the row and cannot be attributed to any bundle. That
 * is a property of the source data, not something the trader can act on.
 */
export const bucketGapReason = (bucket: ArchDetailKey): string | null => {
  switch (bucket) {
    case 'onOrder':
    case 'inTransit':
      return 'It sits on purchase-order lines whose bundles do not exist yet: a PO has no inventory number until it is received';
    case 'reserve':
    case 'readyToBuild':
      return 'It sits on sales-order lines written without inventory detail, so no bundle is named on them';
    case 'outbound':
      // Outbound's gap is normally the WHOLE figure, and by design: shipped wood
      // has left the bundle, the lot's on-hand is already net of it, and the
      // cache deliberately attributes none of it to a lot. This is not a data
      // gap to be closed.
      return 'It has already shipped, so it is no longer on any bundle. This column is shipment history';
    case 'available':
      return 'It is incoming stock on purchase-order lines whose bundles do not exist yet, and a PO has no inventory number until it is received';
    case 'onHand':
      // On Hand is summed FROM the lots, so a gap here is not a detail gap at
      // all. Naming a cause would be a guess; say only what is measured.
      return 'The bundle list and the row total were built from different reads';
    default:
      return null;
  }
};

/**
 * Buckets that have no NetSuite source and therefore read 0 on every row.
 *
 * ⛔ `readyToBuild` is a hardcoded literal 0 in the ARCH cache
 * (mcgi_mr_trader_screen_cache_arch.js) because no field on the transaction
 * feeds it — every candidate `custbody_*` name was probed on 2026-08-18 and none
 * resolved. `action=meta` reports it under `bucketsEmpty`, and on 2026-09-08 the
 * live sandbox still did.
 *
 * This is the answer to Marc-Antoine's question. He expects a new order to land
 * in Ready to Build; it cannot, because the column has nothing behind it. A zero
 * that can never be anything else must not read as a measured zero.
 */
export const notSourcedNote = (bucket: ArchDetailKey): string | null =>
  bucket === 'readyToBuild'
    ? 'Ready to Build has no field in NetSuite yet, so it reads 0 on every row. Stock sold on an order sits in Reserved until it ships.'
    : null;
