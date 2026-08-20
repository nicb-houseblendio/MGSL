/**
 * CWP ARCH (hardwood) data contract.
 *
 * Deliberately separate from `SummaryRow` (lib/api.ts) — ARCH is multi-unit,
 * has no packs/PPP, and carries three things IND/MTL do not: a `readyToBuild`
 * bucket, per-lot tallies, and per-lot PO attribution.
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
  /**
   * Purchase order that brought the lot in, derived from the lot-number prefix.
   *
   * `316027-1` … `316027-14` are bundles from PO 316027. Marc-Antoine confirmed
   * the convention on 2026-08-19: *« le 316027 c'est le numéro du PO qu'on
   * utilise dans notre nomenclature du bundle. »* It is a naming convention, not
   * a NetSuite link, so it can be wrong without being an error. Empty when the
   * lot number does not match the pattern.
   */
  po: string;
  /**
   * Shipping container, and it is NOT the lot prefix.
   *
   * A container can cover more than one PO, so the prefix that yields `po`
   * cannot yield a container in either direction. There is no source for this in
   * NetSuite today — it needs the packing-list lot → container capture — so it
   * is empty on every lot and the detail tables render an em dash. Container is
   * mostly a decking/IPE concern rather than a hardwood one.
   */
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
   * An active Inventory Hold sits on this lot, so it is NOT sellable.
   *
   * Marc-Antoine creates holds to pull stock off the trader screen before
   * posting an Inventory Adjustment. The lot is still reported in `onHand` —
   * the wood is physically on the floor — but it is excluded from `available`.
   *
   * ARCH withholds the WHOLE lot rather than a quantity. The hold record's
   * figure is "Packs on Hold" and ARCH has no packs, so subtracting it from a
   * board-foot balance would be meaningless. This also matches ARCH's existing
   * rule that a bundle with any reserve is locked in full.
   */
  onHold?: boolean;
  /**
   * The hold record's raw "Packs on Hold" figure, carried through untouched.
   *
   * NOT used in any arithmetic. It is here so that if the client later says a
   * hardwood hold is partial rather than whole-lot, it can be reinterpreted
   * without re-reading NetSuite.
   */
  heldPacks?: number;
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
  // Row-level `containerNo` and `containers` were removed 2026-08-19. They fed a
  // Container column and filter on the main grid, and the value they were going
  // to carry turned out to be a PO number. Container lives on the LOT only.
  lots: ArchLot[];

  onHand: number;
  reserve: number;
  readyToBuild: number;
  outbound: number;
  onOrder: number;
  inTransit: number;
  /**
   * Quantity sitting on lots with an active Inventory Hold, in `unit`.
   *
   * Reported rather than silently deducted. MTL subtracts held stock and shows
   * the trader a smaller number with no explanation; ARCH declares it, the same
   * way it declares empty buckets and skipped lots.
   */
  held?: number;
  /** How many of this row's lots are held. */
  heldLotCount?: number;
  /**
   * onHand + onOrder + inTransit − reserve − readyToBuild − outbound − held,
   * floored at 0. Held stock is excluded here and ONLY here.
   */
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
 * Narrowing to one unit is what makes the totals real again, and the Category
 * filter does exactly that — category maps 1:1 to unit (Lumber→BF, Veneer→SQFT,
 * Ovals→pieces, Decking→LF).
 *
 * CORRECTION, 2026-08-18: an earlier note here said category was unpopulated and
 * that the advice pointed at an empty filter. That was wrong — `csegitem_category`
 * carries Lumber/Veneer/Ovals on every hardwood SKU; the cache builder was simply
 * not reading it. The footer still names the units rather than instructing,
 * because stating what IS beats telling someone what to do, but it is a
 * preference now and not a workaround.
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
