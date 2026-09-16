/**
 * Warehouse bundle-split completion.
 *
 * The other half of the bundle-split story. A trader reserves part of a bundle on
 * the trader screen; the WHOLE bundle locks, because nobody knows the real
 * remainder until someone physically splits it. This screen is where that gets
 * resolved — and per the 2026-08-11 call it is deliberately a SEPARATE screen:
 * warehouse staff should not have the trader screen at all, only this.
 *
 * The physical reality drives the data model. The warehouse measures each plank
 * and computes board footage on an iPad, aiming for the trader's target but
 * finishing whatever row of planks it lands in — otherwise the stack is uneven.
 * So a 690 BF bundle asked for at 300 comes back as 288, or 320. Rounding is to
 * the whole inch and differs person to person ("chaque personne va tally d'une
 * manière différente, c'est un peu subjectif"), so even the supplier's figure for
 * the bundle is not authoritative once it is opened.
 *
 * Hence two entered numbers per bundle, and a third that is derived:
 *   customerBF   — what the customer receives
 *   inventoryBF  — what goes back on the floor as a new bundle
 * with their sum being what the bundle actually held, compared against the
 * system's figure to surface a re-tally variance.
 *
 * The client prototype agrees, in its own hint text: "Lot BF and SO BF are shown
 * for reference. Enter the customer bundle and the inventory bundle for each
 * lift."
 */

import type { ArchUnit } from '@/lib/archUom';

export interface ArchSplitBundle {
  /** Lot number of the bundle being split. */
  lotNo: string;
  itemDescription: string;
  /** Species alone, for the grouped list on the queue row. */
  species: string;
  containerNo: string;
  /**
   * The item's stock unit. Lumber is BF, but a veneer bundle would be SQFT and
   * ovals are counted in pieces, so this drives every label on the screen.
   *
   * Whether veneer and ovals are splittable AT ALL is an open question with
   * Marc-Antoine — the argument against is that a split exists because nobody
   * knows the real remainder until the bundle is opened, and for ovals you just
   * take 5 of 12. This field does not presume an answer: it only makes sure that
   * if such a bundle ever reaches the queue it reads "216 units" and not
   * "216 BF".
   */
  unit: ArchUnit;
  /**
   * What the system currently believes the bundle holds, in `unit`.
   *
   * NOTE ON THE NAME: the `*BF` suffix on this and the fields below is now a
   * misnomer, kept deliberately. Renaming them would churn the server contract
   * (`archSplitQueue.js`, `archSplitExecute.js`) and the completion path that
   * P6 has just verified end to end, for a purely cosmetic gain — the arithmetic
   * is unit-agnostic. Read them as "quantity", not as "board feet".
   */
  systemBF: number;
  /** What the trader put on the sales order line — a placeholder target, in `unit`. */
  requestedBF: number;
}

/** A note left on a split job, optionally emailed to the trader who sold it. */
export interface ArchSplitNote {
  /** Short display date, e.g. "Aug 13". */
  date: string;
  text: string;
  /** True when the warehouse asked for the trader to be notified. */
  emailed: boolean;
}

/** One sales order with bundles awaiting a physical split. */
export interface ArchSplitJob {
  soNo: string;
  customer: string;
  /** The trader who sold it — they get the comment notification. */
  trader: string;
  locationName: string;
  /** ISO date the order ships. Drives the urgency pill. */
  shipDate: string;
  bundles: ArchSplitBundle[];
}

/**
 * What the warehouse worker keys in. Strings so a field can be empty mid-edit.
 *
 * TWO values, not three. Marc-Antoine confirmed 2026-08-13 ("Oui d'accord avec
 * ça"): the worker measures the two piles in front of him and the bundle total is
 * their sum. Once a bundle is split there is no whole bundle left to measure, so
 * a third input could only ever hold the system figure or the sum of these two —
 * it never carried an observation. It was also pre-filled from the system, which
 * made it a trap: leave it alone and the screen reported a discrepancy that
 * wasn't one.
 */
export interface ArchSplitEntry {
  customerBF: string;
  inventoryBF: string;
}

/**
 * What completing a split SHOULD do in NetSuite, expressed as intent.
 *
 * Not executed — the mechanics are explicitly unresolved ("il y a peut-être une
 * couple d'affaires là-dedans... il faut réfléchir à c'est quoi la mécanique de
 * ça"). Stating it in words lets the mechanics be agreed against something
 * concrete instead of in the abstract.
 */
export interface ArchSplitOutcome {
  lotNo: string;
  /** Unit of every quantity below, carried from the bundle that was split. */
  unit: ArchUnit;
  /** Sales order line quantity corrected from the placeholder to the real figure. */
  soLineBF: number;
  /**
   * Board feet left on the lot that KEEPS the parent's number, which since
   * Feedback 6 item 16 is the wood going back into stock.
   *
   * 🔴 NAMED FOR THE PIECE, NOT FOR THE LOT RECORD, and deliberately so. These were
   * `originalLotBF` and `newLotBF`, which stayed accurate only while the parent
   * number followed the customer's wood. Item 16 reversed that and the two fields
   * silently began describing the opposite bundles, in the panel a warehouse worker
   * reads to label physical wood, while the banner below it stated the new rule
   * correctly in prose. A name that survives the next reversal is worth more than a
   * name that matches the old comment.
   */
  stockLotBF: number;
  /** Board feet on the newly minted bundle, which is the customer's piece. */
  customerLotBF: number;
  /**
   * The lot number NetSuite minted for the CUSTOMER's piece, as returned by the
   * server. It named the remainder until Feedback 6 item 16.
   *
   * 🔴 `null` until the split has actually run. The client does NOT derive this.
   * The server mints it with a collision check at write time (`nextChildLotNumber`
   * in `archSplitExecute.js`), and a name computed here would be a guess in the
   * numeric namespace RECEIVING uses for a second bundle on one PO line. See the
   * block comment in `lib/archSplit.ts`.
   */
  newLotNo: string | null;
  /** Difference between what was measured and what the system believed. */
  systemVarianceBF: number;
}
