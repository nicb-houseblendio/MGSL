/**
 * CWP ARCH (hardwood) data contract.
 *
 * Deliberately separate from `SummaryRow` (lib/api.ts) — ARCH is multi-unit,
 * has no packs/PPP, and carries three things IND/MTL do not: a `readyToBuild`
 * bucket, per-lot tallies, and lot-level container numbers.
 *
 * This is the shape the ARCH RESTlet is expected to return once it exists. Until
 * then `lib/archFixtures.ts` produces it. Keeping the contract explicit here means
 * swapping fixtures for the real endpoint touches one hook, not the components.
 *
 * QUANTITIES ARE IN THE ITEM'S OWN STOCK UNIT, carried on `unit`. ARCH is not
 * board-foot native: Lumber is BF, Veneer is SQFT, Ovals are counted in units,
 * and Decking will be LF. Never MBF, never packs — the MBF→BF conversion is the
 * data layer's job and has already happened by the time a row reaches here.
 * Display conversion to cubic metres happens at render time and applies to BF
 * only — see lib/archUom.ts.
 */

import type { ArchUnit } from '@/lib/archUom';

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
  /** Physically on hand, in the parent row's `unit`. */
  onHand: number;
  /**
   * Reserved against a sales order, in the parent row's `unit`.
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
  /**
   * The item's stock unit — what every quantity on this row and its lots is
   * counted in. Derived server-side from `unitstypeuom.unitname`; see
   * `normalizeUnit`. Defaults to BF when absent, which is the majority case.
   */
  unit: ArchUnit;
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

  /**
   * Average lot cost in dollars per ONE `unit` — per BF for Lumber, per SQFT
   * for Veneer, per piece for Ovals. Never per MBF.
   *
   * NULL when costing is not available, which is the live case today: the ARCH
   * cache builder has no lot costing wired. It is null rather than 0 because
   * `$0.00/BF` is indistinguishable from stock that genuinely cost nothing —
   * the same reason the empty quantity buckets are declared in `meta`.
   */
  avgCostPerUnit: number | null;

  /** Stable row identity: `${internalId}-${locationId}`. */
  detailKey: string;
}

/**
 * Column totals across the filtered rows.
 *
 * ⚠️ The sums are only meaningful when every row shares one unit. Board feet,
 * square feet and pieces do not add up, so `units` reports what actually went
 * into them and the footer refuses to print a number when there is more than
 * one — it names the units present instead.
 *
 * Narrowing to one unit is what makes the totals real again. Do NOT tell the
 * user to do that via the Category filter: the ARCH cache emits an empty
 * `category` on every row because `csegitem_category` is unpopulated, so that
 * advice points at a filter with no options.
 */
export interface ArchTotals {
  onHand: number;
  reserve: number;
  readyToBuild: number;
  outbound: number;
  onOrder: number;
  inTransit: number;
  available: number;
  /** Distinct units present in the rows these totals cover. */
  units: ArchUnit[];
}
