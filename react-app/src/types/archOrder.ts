/**
 * CWP ARCH sales-order creation model.
 *
 * The differentiator for this screen: hardwood traders build the SO from the
 * trader screen rather than the NetSuite SO form ("la grosse différence avec les
 * autres trader screens, c'est qu'on a la fonctionnalité de créer des SO à partir
 * du trader screen", 2026-08-11 call).
 *
 * ⚠️ NOTHING HERE WRITES TO NETSUITE YET. The wizard produces an `ArchOrderDraft`
 * and stops. Several of the decisions it would need are still open on the client
 * side — how a split line is marked, where reman/cutting live on the SO, the real
 * fee rates, and the SO header field IDs. The draft is deliberately shaped as
 * INTENT ("this line is a split, target 300 BF") rather than as a NetSuite
 * payload, so the persistence layer can be written once those land without
 * reshaping the UI.
 */

import type { ArchDetailKey } from '@/types/arch';
import type { ArchUnit } from '@/lib/archUom';

/** One lot picked off the grid and added to the order. */
export interface ArchCartLine {
  /** `${internalId}|${bucket}|${lotNo}` — stable, and unique per lot per bucket. */
  key: string;
  internalId: string;
  itemCode: string;
  description: string;
  /**
   * Nominal thickness, e.g. "6/4". Carried from the summary row so the planing
   * options don't have to be recovered by regex from `description` — that only
   * works because the fixtures format descriptions as `${species} ${thickness} KD`,
   * which real NetSuite item descriptions will not guarantee.
   */
  thickness?: string;
  locationName: string;
  lotNo: string;
  containerNo: string;
  /**
   * The item's stock unit, carried from the summary row.
   *
   * A cart can mix a Lumber line in BF with a Veneer line in SQFT, so the unit
   * has to travel with the LINE — there is no single unit for an order. The
   * `*BF` names on the fields below are kept for contract stability; read them
   * as "quantity", "cost per unit" and "price per unit".
   */
  unit: ArchUnit;
  /** Quantity this lot contributes, in `unit`, from the bucket it was selected from. */
  bf: number;
  /**
   * Lot cost per one `unit` — drives the margin estimate.
   *
   * NULL when the source row carries no costing (see `ArchSummaryRow`). The
   * pricing engine already treats it as 0 for arithmetic, which means a line
   * with unknown cost reads as pure margin — see the note on `ArchOrderTotals`.
   */
  costPerBF: number | null;
  bucket: ArchDetailKey;
  /** True when the line came from an existing SO rather than the grid. */
  existing?: boolean;
  /**
   * Fulfillment status of this line on an existing order.
   *
   * ⚠️ The client prototype shows per-line statuses including "Ready to Build",
   * but Marc-Antoine answered on 2026-08-13 that Ready to Build is a HEADER
   * status ticked manually by the trader. His own diagram also annotates
   * "sometimes we have some lines on the SO ready to build, but not the full
   * order". The two do not agree. We mirror the prototype here so he has
   * something concrete to react to, and the contradiction is on the list to
   * raise with him.
   */
  lineStatus?: ArchOrderStatus;
  /**
   * Price already agreed on an existing SO line, $/BF.
   * Seeds the Pricing step — without it "add to existing order" dead-ends,
   * because the trader is asked to re-invent a price for stock already sold.
   */
  pricePerBF?: number;
}

/**
 * Bundle split intent for one line.
 *
 * `targetBF` is a PLACEHOLDER quantity, not a promise. The warehouse measures
 * each plank and finishes the row it lands in, so the real figure comes back
 * different (690 BF bundle, 300 asked, 288 or 320 delivered). The whole bundle
 * stays locked until the split is completed — see `isLotLocked` in lib/archLots.
 */
export interface ArchSplitIntent {
  on: boolean;
  /** Kept as a string so the input can be empty mid-edit. */
  targetBF: string;
}

/**
 * Remanufacturing intent for one line.
 *
 * ARCH reman is a SERVICE with a fee, not the Industriel reman: no new SKU and no
 * inventory adjustment. Both the surfacing spec and the cut length are free-form
 * until the client decides whether these live in the line description or in
 * dedicated fields.
 */
export interface ArchRemanIntent {
  planing: boolean;
  /** Target dressed thickness, e.g. "15/16", or "other". */
  planingSpec: string;
  planingOther: string;
  cutting: boolean;
  /** Target length, e.g. "8'". */
  cutLength: string;
}

export interface ArchOrderHeader {
  customer: string;
  customerPO: string;
  shipTo: string;
  currency: string;
  shipDate: string;
  incoterms: string;
  salesTeam: string;
  paymentTerms: string;
}

export type ArchOrderMode = 'new' | 'existing';

export interface ArchOrderDraft {
  mode: ArchOrderMode;
  /** Set when adding to an existing order. */
  existingSO: string | null;
  header: ArchOrderHeader;
  lines: ArchOrderDraftLine[];
  totals: ArchOrderTotals;
}

export interface ArchOrderDraftLine {
  lotNo: string;
  itemCode: string;
  description: string;
  locationName: string;
  containerNo: string;
  /** The item's stock unit — see the note on `ArchOrderLine.unit`. */
  unit: ArchUnit;
  /** Quantity actually going on the order, in `unit` — the split target when split. */
  bf: number;
  /** Null when the source row carries no costing — see `ArchOrderLine.costPerBF`. */
  costPerBF: number | null;
  pricePerBF: number;
  isSplit: boolean;
  /** Full lot size, retained so the warehouse knows what it is splitting from. */
  lotBF: number;
  reman: ArchRemanIntent;
}

/**
 * ⚠️ COST-DERIVED FIGURES ARE ONLY AS GOOD AS THE LINE COSTS. `archOrderPricing`
 * treats a null `costPerBF` as 0, so a line whose cost is unknown contributes
 * nothing to `lotCost` and reports as pure profit. That is unreachable today —
 * order lines are built from fixtures, which always carry a cost — but it goes
 * live the moment the wizard is fed by the real ARCH cache, which currently
 * emits no costing at all. Give the margin readout an explicit "cost unknown"
 * state before that happens.
 */
export interface ArchOrderTotals {
  /**
   * ⚠️ Sum of every line's quantity REGARDLESS OF UNIT, so it is only a real
   * figure on a single-unit order. Money totals below are always valid — dollars
   * add up whatever the lines are counted in. For a quantity a human will read,
   * use `formatUnitTotals` over the lines instead of printing this.
   */
  bf: number;
  revenue: number;
  lotCost: number;
  processingCost: number;
  opsInsuranceCost: number;
  profit: number;
  marginPct: number;
}

/** Where an order sits in the flow. Drives the pill colour and Edit gating. */
export type ArchOrderStatus = 'Reserved' | 'Ready to Build' | 'In Transit';

/** An open SO the trader can append lines to. */
export interface ArchOpenOrder {
  soNo: string;
  customer: string;
  /** The individual who sold it. Open orders are grouped by this. */
  trader: string;
  shipTo: string;
  currency: string;
  incoterms: string;
  created: string;
  status: ArchOrderStatus;
  /** ISO date already on the order — inherited so the header step is complete. */
  shipDate: string;
  salesTeam: string;
  lines: ArchCartLine[];
}
