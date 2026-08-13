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
 * Hence THREE numbers per bundle, not one:
 *   measuredBF   — what the bundle actually held, once opened and re-tallied
 *   customerBF   — what the customer receives
 *   inventoryBF  — what goes back on the floor as a new bundle
 * with customerBF + inventoryBF reconciling to measuredBF within a tolerance.
 */

export interface ArchSplitBundle {
  /** Lot number of the bundle being split. */
  lotNo: string;
  itemDescription: string;
  containerNo: string;
  /** Board feet the system currently believes the bundle holds. */
  systemBF: number;
  /** Board feet the trader put on the sales order line — a placeholder target. */
  requestedBF: number;
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

/** What the warehouse worker keys in. Strings so a field can be empty mid-edit. */
export interface ArchSplitEntry {
  measuredBF: string;
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
  /** Sales order line quantity corrected from the placeholder to the real figure. */
  soLineBF: number;
  /** Board feet remaining on the original lot after the split. */
  originalLotBF: number;
  /** Board feet on the newly created bundle. */
  newLotBF: number;
  /** New lot number — the original with an incrementing `-N` suffix. */
  newLotNo: string;
  /** Difference between what was measured and what the system believed. */
  systemVarianceBF: number;
}
