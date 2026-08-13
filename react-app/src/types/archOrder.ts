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
  /** Board feet this lot contributes, in the bucket it was selected from. */
  bf: number;
  /** Lot cost per board foot — drives the margin estimate. */
  costPerBF: number;
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
  /** Board feet actually going on the order — the split target when split. */
  bf: number;
  costPerBF: number;
  pricePerBF: number;
  isSplit: boolean;
  /** Full lot size, retained so the warehouse knows what it is splitting from. */
  lotBF: number;
  reman: ArchRemanIntent;
}

export interface ArchOrderTotals {
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
