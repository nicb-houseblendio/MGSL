/**
 * PO lines with no bundles, Feedback 8 step 2.8c.
 *
 * Marc-Antoine, 2026-09-17: « si jamais on facture avant réception et qu'on a
 * pas de packing list, alors on présentera la ligne dans le TS sans le détail
 * des bundles. Ce sera un flag pour l'équipe. »
 *
 * Pure, so the drill-down's arithmetic and wording are tested by EXECUTION, not
 * by matching source text (round-1 review of 6210842).
 */
import type { ArchSummaryRow, ArchLot, ArchUnbundledLine } from '@/types/arch';

export type IncomingBucket = 'onOrder' | 'inTransit';

/** Anything under half a display unit renders as "0" and is dust, not a line. */
const DUST = 0.5;

export interface NoPackingListFlag {
  /** In-transit quantity on billed-ahead lines with no bundles, in the row's unit. */
  qty: number;
  /** The POs concerned, de-duplicated, in the order the cache listed them. */
  poNumbers: string[];
}

/**
 * The grid flag. Keyed on `billedAhead`, NOT on the arm: a line with take
 * ownership AND a supplier invoice is arm 'journal' and still his case.
 */
export const noPackingListFlag = (row: Pick<ArchSummaryRow, 'unbundled'>): NoPackingListFlag | null => {
  const lines = (row.unbundled || []).filter((u) => u.billedAhead && (u.inTransit || 0) >= DUST);
  if (!lines.length) return null;
  return {
    qty: lines.reduce((s, u) => s + u.inTransit, 0),
    poNumbers: [...new Set(lines.map((u) => u.poNumber || '—'))],
  };
};

/**
 * The badge for one unbundled entry ON ONE TAB. The tab matters: a partly billed
 * line's un-billed part sits on On Order, where "no packing list, billed before
 * receipt" would be false.
 */
export const unbundledBadge = (u: ArchUnbundledLine, bucket: IncomingBucket): { text: string; title: string } => {
  if (u.arm === 'closed') {
    return {
      text: 'PO closed',
      title: 'This PO is closed but the line still has quantity open, so it is counted here. ' +
        'If the wood is not coming, the open quantity should be cleared on the PO.',
    };
  }
  if (bucket === 'inTransit' && u.billedAhead) {
    return {
      text: 'No packing list',
      title: 'Billed before receipt and no packing list yet, so this line has no bundle numbers. ' +
        'Back office: enter the packing list and generate the bundles on the PO.',
    };
  }
  if (u.partlyReceived) {
    return {
      text: 'Partly received',
      title: 'Part of this PO line is already received; the rest has no bundle numbers. ' +
        'If the remainder is not coming, close it on the PO.',
    };
  }
  return {
    text: 'No bundles yet',
    title: 'This PO line has no bundle numbers yet, so it cannot be listed bundle by bundle. ' +
      'They are created with Generate Tags on the PO.',
  };
};

export interface PoListTotals {
  lots: ArchLot[];
  unbundled: ArchUnbundledLine[];
  lotTotal: number;
  unbundledTotal: number;
  /**
   * What the row carries that neither list shows: a bundle on an open PO line
   * that the lot query did not return, or an older payload with no `unbundled`.
   * Negative when the lots over-claim the row. Shown as its own line whenever it
   * is at least half a unit either way, so the footer ALWAYS equals the tab.
   */
  residual: number;
  /** Always the row's own figure. */
  total: number;
}

export const poListTotals = (row: ArchSummaryRow, bucket: IncomingBucket): PoListTotals => {
  const lots = row.lots.filter((l) => (l[bucket] || 0) > 0);
  const unbundled = (row.unbundled || []).filter((u) => (u[bucket] || 0) >= DUST);
  const lotTotal = lots.reduce((s, l) => s + (l[bucket] || 0), 0);
  const unbundledTotal = unbundled.reduce((s, u) => s + (u[bucket] || 0), 0);
  const total = row[bucket] ?? 0;
  const rawResidual = total - lotTotal - unbundledTotal;
  return {
    lots, unbundled, lotTotal, unbundledTotal,
    residual: Math.abs(rawResidual) >= DUST ? rawResidual : 0,
    total,
  };
};
