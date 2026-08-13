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

export interface ArchSplitBundle {
  /** Lot number of the bundle being split. */
  lotNo: string;
  itemDescription: string;
  /** Species alone, for the grouped list on the queue row. */
  species: string;
  containerNo: string;
  /** Board feet the system currently believes the bundle holds. */
  systemBF: number;
  /** Board feet the trader put on the sales order line — a placeholder target. */
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
