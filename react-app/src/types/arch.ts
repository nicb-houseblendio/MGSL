import type { TallyBundle } from '@/lib/archTally';
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

/**
 * One sales order holding part of a bundle's `reserve`.
 *
 * ── WHERE IT COMES FROM ─────────────────────────────────────────────────────
 * The ARCH cache MR, from the SAME `inventoryassignment` join that produces the
 * per-lot reserve quantity: the assignment names the order LINE, the line names
 * the order. No extra query, so it costs nothing to carry.
 *
 * Before 2026-09-08 the Reserved panel filled its SO #, SO Creation Date,
 * Reserved For, Ship Week, Customer and Trader columns from `lotAllocation()` in
 * lib/archFixtures.ts — a seeded generator — and a trader reading an SO number
 * off that panel would have believed it. This is that link, real.
 *
 * ── A BUNDLE CAN BE HELD BY SEVERAL ORDERS ──────────────────────────────────
 * Measured in the sandbox on 2026-09-08: 31 inventory numbers sit on an open,
 * unshipped line of two or more sales orders at once, the worst at 17 orders on
 * one lot. So `ArchLot.orders` is a LIST and the panel renders one row per
 * (bundle, order) rather than choosing a winner.
 */
export interface ArchLotOrder {
  /** NetSuite internal id of the sales order. The link target, and the identity. */
  tranId: string;
  /**
   * Which bucket this order's share of the bundle landed in: `true` for Ready to
   * Build, `false` for Reserved. Stamped by the cache MR from the same
   * `readyToBuildIds` map that decided the quantity, so the two cannot disagree.
   *
   * ⚠️ OPTIONAL ON PURPOSE, and `archLotOrders.ts` checks for it before trusting
   * it. A cache written by the previous MR has no such key, and on that payload
   * the Ready to Build tab must keep showing an em dash rather than a list that
   * may belong to the Reserved tab. Added 2026-09-14.
   */
  readyToBuild?: boolean;
  /** The document number, e.g. "SO-CWP-001344". `t.tranid`, not `t.id`. */
  soNumber: string;
  customerId: string;
  /** `BUILTIN.DF(t.entity)`. Empty when the caller's role cannot read the name. */
  customer: string;
  /** `t.trandate` as `YYYY-MM-DD`. Empty when absent. Parse as LOCAL midnight. */
  created: string;
  /**
   * `t.shipdate` as `YYYY-MM-DD`, which feeds the Ship Week column.
   *
   * The NATIVE field, and it is populated: 6 of 6 open ARCH sales-order lines
   * carry one. `custbody_mgsl_expectedshipdate` does NOT exist on the record even
   * though SuiteQL will let you select the column.
   */
  shipDate: string;
  repId: string;
  /**
   * The trader, from the order's Sales Team SUBLIST.
   *
   * `transaction.employee` (the header Sales Rep) is NULL on every ARCH order
   * because Team Selling puts the rep on the sublist — reading the header alone
   * is what once grouped every real order under "Unassigned". Resolved by
   * `shared/archSalesTeam.js`, the same module the Open Orders tab uses, so the
   * two views cannot name two different people for one order.
   */
  rep: string;
  /** Which rung of the fallback answered. 'none' means nobody is named. */
  repSource?: 'salesTeam' | 'header' | 'none';
  /** More than one rep on the order's Sales Team; `repTied` when they split evenly. */
  repShared?: boolean;
  repTied?: boolean;
  /** The rep's id resolved but their NAME did not, so `rep` reads "Employee <id>". */
  repNameUnreadable?: boolean;
  /**
   * THIS order's share of the bundle's reserve, in the parent row's `unit`.
   *
   * Scaled by the line's open share, exactly like `ArchLot.reserve`, so a
   * shipped-and-billed line contributes 0 and never appears. The shares across a
   * bundle's orders sum to its `reserve` by construction.
   */
  qty: number;
}

export interface ArchLot {
  lotNo: string;
  /**
   * NetSuite internal id of the inventory number.
   *
   * The cache has always sent this; the type simply did not declare it. It is
   * what the order endpoint identifies a bundle by — a lot NUMBER is not unique
   * across items, and `issueinventorynumber` rejects a name outright.
   */
  lotId: string;
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
   * What THIS bundle cost, per display unit, Feedback 6 item 18: "IA-CWP-730. Le
   * MBF price est 12.76 vs 14.15."
   *
   * 🔴 NOT the row's `avgCostPerUnit`, which is what every cart line used to be
   * priced against. That figure is an on-hand-weighted average across every costed
   * lot in the item and location, so a trader picking the dearest bundle was quoted
   * a blend: lot 316027-9 cost 14.15 and the screen said 12.76, the average of the
   * 21 ZEB84KD bundles at CWP Prevost, which run 12.25 to 14.15.
   *
   * ⚠️ NULL, NOT ZERO, for a lot with no posting history. The row-level average has
   * always excluded those from both sides rather than counting them as free, and a
   * consumer that reads null as 0 prices the wood at nothing. Absent entirely on a
   * payload built before 2026-09-16, which is why it is optional.
   */
  costPerUnit?: number | null;
  /**
   * The same cost converted to USD at the rate on THIS lot's receipt date,
   * Feedback 9 item 1. Marc-Antoine asked for BF cost in USD at the
   * inventory-receipt rate, and the rate is per lot because the receipt date
   * is per lot: two bundles of the same item bought four months apart
   * convert at different rates and should.
   *
   * 🔴 NULL MEANS NO RATE, WHICH IS NOT THE SAME AS NO COST. `costPerUnit`
   * being null means the lot has no posting history; this being null means it
   * has a cost that could not be converted, because its receipt date falls
   * outside what the NetSuite rate table covers (it begins 2025-03-26) or
   * because the lot carries no receipt date at all. Those lots keep showing
   * their CAD figure LABELLED CAD. Loading historical rates into NetSuite is
   * what fixes them, not a change here.
   *
   * ⚠️ Do not convert this back, or convert the CAD one, anywhere near the
   * order wizard. The wizard does its own CAD-to-order-currency conversion at
   * the ORDER's stamped rate, which is a different rate for a different
   * question, and doing both is the 11-margin-point error `SOWizard.tsx`
   * documents. Absent on a payload built before 2026-09-21.
   */
  costPerUnitUsd?: number | null;
  /**
   * Shipping container, and it is NOT the lot prefix.
   *
   * A container can cover more than one PO, so the prefix that yields `po`
   * cannot yield a container in either direction.
   *
   * 🔴 CORRECTED 2026-09-21. This said "There is no source for this in
   * NetSuite today" and was wrong on two counts. Two sources exist:
   *
   *   1. the packing-list capture's `custrecord_msl_plc_container_no`, which
   *      holds a real ISO 6346 code (capture record 1 is "PL 314307 IPE
   *      MEDU7574050"). Authoritative, and it wins.
   *   2. `custbody5` (Lot Vessel) on the inventory adjustment, which is what
   *      Marc-Antoine asked for in Feedback 9 item 2. Measured account-wide it
   *      holds real ship names: ULTRA YORKSHIRE, SAGA ANDORINHA, SEA WAVE,
   *      KARLINO, and "Inbound Truck".
   *
   * ⚠️ STILL EMPTY ON EVERY ARCH LOT, but now for a DATA reason rather than
   * a missing-source one, and the distinction decides who fixes it. All 210
   * vessel-bearing ARCH adjustments carry the lot's own prefix instead of a
   * vessel (lot 314307-1535, vessel "314307"), and by Marc-Antoine's 2026-08-19
   * answer that number is the PO. The builder refuses it rather than shipping a
   * column headed Container full of PO numbers. Correcting the import is what
   * fills this, not a change here.
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
  /**
   * The sales orders holding `reserve`, newest last. See `ArchLotOrder`.
   *
   * 🔴 `undefined` AND `[]` MEAN DIFFERENT THINGS, and the distinction is the
   * whole point of the field:
   *
   *   an array (including empty) → the payload came from a cache that knows
   *                                about order attribution. Trust it, and render
   *                                NOTHING where a value is absent.
   *   `undefined`                → lib/archFixtures.ts, or a cache written before
   *                                2026-09-08. The SO columns fall back to the
   *                                generator and the placeholder banner shows.
   *
   * The MR therefore emits the key on EVERY lot, `[]` included. Do not "tidy" it
   * away on unreserved bundles: that saves under a kilobyte and makes a fixture
   * indistinguishable from real data on every lot that has no reservation.
   *
   * `lib/archLotOrders.ts` is the single place that reads this distinction.
   */
  orders?: ArchLotOrder[];
  /** Reserved AND released to the warehouse to be prepared. No longer editable. */
  readyToBuild: number;
  outbound: number;
  onOrder: number;
  inTransit: number;
  /**
   * Where this bundle is coming from and when it is expected, read from the open
   * purchase-order line that carries it. Resolved server-side by the ARCH cache
   * MR; added 2026-09-17.
   *
   * 🔴 NULL AND ABSENT MEAN DIFFERENT THINGS, the same distinction `orders`
   * makes and for the same reason:
   *
   *   an object      this cache resolved a live PO line. Render it.
   *   `null`         this cache looked and the bundle sits on no open PO line.
   *                  Render nothing, not a guess.
   *   `undefined`    fixtures, or a cache written before 2026-09-17. Only then
   *                  may `lotIncomingInfo` invent one, and the view says so.
   *
   * Before this existed the On Order table printed a seeded-PRNG supplier and a
   * seeded-PRNG date beside real lot numbers, with nothing on screen to say they
   * were invented.
   */
  incoming?: {
    /**
     * The PO document number, e.g. "PO-CWP-001326". The REAL one off the order
     * line, not the lot-number prefix that `po` above is derived from — which
     * is a naming convention, can be wrong, and is empty on any bundle whose
     * prefix is under five digits (`1333-1`).
     */
    poNumber: string;
    /** Vendor name off the PO header. */
    supplier: string;
    /**
     * `custbody_ship_week`, ISO `YYYY-MM-DD`, or '' where the PO carries none.
     *
     * ⚠️ Parse as LOCAL (`new Date(iso + 'T00:00:00')`). A bare `new Date(iso)`
     * is UTC midnight, which is the previous day anywhere west of Greenwich,
     * Montreal included.
     */
    eta: string;
  } | null;
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
   * File-cabinet URL of the supplier tally (a photo/scan of the packing list),
   * uploaded BY HAND against the lot. A different thing from `tally` below, which
   * is the parsed document. The dialog can show both.
   * Null when no image has been attached to the lot yet.
   */
  tallyImageUrl?: string | null;
  /**
   * The PARSED tally for this lot, resolved server-side by the ARCH cache MR from
   * `customrecord_msl_plc_capture`. Added 2026-09-07, when the serve side was built.
   *
   * 🔴 NULL IS THE COMMON AND CORRECT CASE, not a failure. A lot only carries a
   * tally when some bundle inside a stored payload names it EXACTLY. Suppliers number
   * bundles 1535-1548 while NetSuite numbers the same goods 316027-1, so most lots
   * legitimately have none: SDD s4.2, "the push never guesses a lot". Those fall back
   * to the document, then to the dialog's empty state.
   *
   * `bundles` are the raw payload objects, carried through unreshaped so that
   * `archTally.ts` remains the single implementation of the arithmetic. Run
   * `checkPayload()` over them before drawing a total.
   */
  tally?: {
    /** PARSED | MATCHED | REVIEWED. Resolved by NAME: the list ids differ per environment. */
    status: string;
    /** The document this came from, for the provenance line. */
    sourceFile?: string | null;
    /** The source document itself, the middle rung of the fallback chain. */
    docUrl?: string | null;
    /** Raw `mgsl.tally.v1` bundle objects whose `lot` matched this lot exactly. */
    bundles: TallyBundle[];
  } | null;

  /**
   * Whether this lot's tally can still be trusted, derived server-side by the
   * ARCH cache MR. Added 2026-09-15.
   *
   *   undefined / null   no split on record. Ordinary lot.
   *   'staleParent'      the lot WAS split and a tally names it, but that tally
   *                      predates the split, so its matrix describes wood that is
   *                      no longer all here.
   *   'newChild'         the lot was CREATED by a split and no supplier document
   *                      has ever described it. This is a DIFFERENT thing from the
   *                      hundreds of lots that simply never had a tally, and it is
   *                      the case Marc-Antoine asked for on 2026-09-10 at 26:54.
   *
   * 🔴 SEPARATE FROM `tally`, not inside it, because 'newChild' is exactly the
   * case where `tally` is null and there would be nowhere inside it to put this.
   *
   * Clears itself: a capture modified after the split means somebody re-tallied
   * the lot, and that works whether the re-tally arrives as a new capture or as an
   * edit of the existing one. Known limit, the server comment says it in full: the
   * timestamp is per RECORD, so any edit to a capture clears the flag for every lot
   * in that document.
   */
  tallyState?: 'staleParent' | 'newChild' | null;
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
   * onHand − reserve − readyToBuild − held, floored at 0.
   *
   * ⚠️ CORRECTED 2026-09-22: `onOrder` AND `inTransit` were both in this sum
   * and neither is any more. Available means what the order endpoint will
   * accept. The client does call in-transit wood sellable, and it will be, but
   * not until the reservation phases land: today `isLotLocked` and the server
   * both refuse a bundle with no yard stock, so counting it here would offer
   * volume no trader can actually put on an order.
   * Held stock is excluded here and ONLY here.
   *
   * ⚠️ CORRECTED 2026-09-08. This used to read "… − outbound − held" and to say
   * that all three of reserve, readyToBuild and outbound are subtracted as
   * "successive stages of one pipeline". `outbound` is not a stage of that
   * pipeline — it is `quantityshiprecv`, wood that has already left on an Item
   * Fulfillment, so `onHand` is already net of it and subtracting it removed the
   * same stock twice. Measured on lot 315643-7 of PUR44KD @ Ramsey Xpress:
   * 511 BF received, 300 shipped, quantityonhand 0.211 — and the row reported
   * Available 1,454 against 1,754 BF of free, uncommitted hardwood. The full
   * measurement is in the cache MR beside the formula.
   *
   * reserve and readyToBuild ARE subtracted, and that half still has to agree
   * with `commitmentOn` in archLots.ts: a row reporting Available while every one
   * of its bundles is locked shows unsellable stock as sellable. `commitmentOn`
   * also counts `outbound`, which is now dead weight for live rows — the cache no
   * longer attributes a shipped quantity to any lot — but stays true for
   * lib/archFixtures.ts, whose generator models outbound as a claim on on-hand
   * stock and still subtracts it. That generator is the one place left carrying
   * the old reading.
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

  /**
   * `avgCostPerUnit` converted to USD, Feedback 9 item 1.
   *
   * 🔴 NOT `avgCostPerUnit` divided by one rate. It is the on-hand-weighted
   * average of the per-lot USD costs, because each lot converts at its own
   * receipt-date rate. Dividing the CAD average by a single rate would be a
   * different number whenever a row holds bundles received on different days,
   * which is the normal case.
   *
   * Weighted over the lots that have BOTH a cost and a rate. `costUsdPartial`
   * says when that is a strict subset of the lots behind `avgCostPerUnit`.
   */
  avgCostPerUnitUsd?: number | null;

  /**
   * True when some costed lot on this row had no convertible receipt date, so
   * the CAD and USD averages describe different sets of lots and
   * `avgCostPerUnitUsd * rate` will not reproduce `avgCostPerUnit`.
   */
  costUsdPartial?: boolean;

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
