/**
 * The team flag for in-transit wood with no packing list, Feedback 8 step 2.8c.
 *
 * Marc-Antoine, 2026-09-17: « si jamais on facture avant réception et qu'on a
 * pas de packing list, alors on présentera la ligne dans le TS sans le détail
 * des bundles. Ce sera un flag pour l'équipe. »
 *
 * Only the 'billed' arm is his case: the supplier invoiced before delivery, so
 * the wood is in transit and nobody has entered its bundles. A take-ownership
 * line with no bundles yet is the normal Generate Tags gap and does not need the
 * team's attention on the grid; the drill-down still lists it.
 */
import type { ArchSummaryRow } from '@/types/arch';

export interface NoPackingListFlag {
  /** In-transit quantity on billed-ahead lines with no bundles, in the row's unit. */
  qty: number;
  /** The POs concerned, de-duplicated, in the order the cache listed them. */
  poNumbers: string[];
}

export const noPackingListFlag = (row: Pick<ArchSummaryRow, 'unbundled'>): NoPackingListFlag | null => {
  const lines = (row.unbundled || []).filter((u) => u.arm === 'billed' && (u.inTransit || 0) > 1e-9);
  if (!lines.length) return null;
  return {
    qty: lines.reduce((s, u) => s + u.inTransit, 0),
    poNumbers: [...new Set(lines.map((u) => u.poNumber || '—'))],
  };
};
