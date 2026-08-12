/**
 * CWP ARCH (hardwood) data contract.
 *
 * Deliberately separate from `SummaryRow` (lib/api.ts) — ARCH is board-foot native,
 * has no packs/PPP, and carries three things IND/MTL do not: a `readyToBuild`
 * bucket, per-lot tallies, and lot-level container numbers.
 *
 * This is the shape the ARCH RESTlet is expected to return once it exists. Until
 * then `lib/archFixtures.ts` produces it. Keeping the contract explicit here means
 * swapping fixtures for the real endpoint touches one hook, not the components.
 *
 * ALL QUANTITIES ARE BOARD FEET (BF). Never MBF, never packs. Display conversion
 * to cubic metres happens at render time — see lib/archUom.ts.
 */

/** Quantity buckets that map 1:1 to a column on the grid. */
export type ArchQtyKey =
  | 'onHand'
  | 'reserve'
  | 'readyToBuild'
  | 'outbound'
  | 'onOrder'
  | 'inTransit';

/** Buckets a detail modal can open on. `available` is derived, not stored. */
export type ArchDetailKey = ArchQtyKey | 'available';

export interface ArchLot {
  lotNo: string;
  /** Purchase order that brought the lot in (On Order / In Transit / received). */
  po: string;
  containerNo: string;
  /** Board feet physically on hand. */
  onHand: number;
  /**
   * Board feet reserved against a sales order.
   *
   * NOTE: a bundle with ANY reserve is locked in full — a trader selling 300 BF
   * off a 690 BF bundle blocks the whole bundle, because the real remainder is
   * unknown until the warehouse physically splits it. The UI enforces this by
   * disabling selection on `reserve > 0`, not by comparing reserve to onHand.
   */
  reserve: number;
  /** Reserved AND released to the warehouse to be prepared. No longer editable. */
  readyToBuild: number;
  outbound: number;
  onOrder: number;
  inTransit: number;
  /**
   * File-cabinet URL of the supplier tally (a photo/scan of the packing list).
   * Null when no tally has been attached to the lot yet.
   */
  tallyImageUrl?: string | null;
}

export interface ArchSummaryRow {
  internalId: string;
  itemCode: string;
  /** Human label shown in the grid, e.g. "African Mahogany 4/4 KD". */
  description: string;
  locationId: string;
  locationName: string;
  species: string;
  /** Quarter notation — "4/4", "5/4", "8/4", "12/4". */
  thickness: string;
  category: string;
  grade: string;
  grain: string;
  /** First container of the lot set, for the collapsed grid cell. */
  containerNo: string;
  /** Every distinct container across this row's lots (drives the filter). */
  containers: string[];
  lots: ArchLot[];

  onHand: number;
  reserve: number;
  readyToBuild: number;
  outbound: number;
  onOrder: number;
  inTransit: number;
  /** onHand + onOrder + inTransit − reserve − readyToBuild − outbound, floored at 0. */
  available: number;

  /** Average lot cost in dollars per BOARD FOOT (not per MBF). */
  avgCostBF: number;

  /** Stable row identity: `${internalId}-${locationId}`. */
  detailKey: string;
}

export interface ArchTotals {
  onHand: number;
  reserve: number;
  readyToBuild: number;
  outbound: number;
  onOrder: number;
  inTransit: number;
  available: number;
}
