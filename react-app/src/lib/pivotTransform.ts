import type { InventoryRow } from '@/types';

export interface PivotRow {
  id: string;
  width: string;
  length: string | null;
  isGroupRow: boolean;
  onHand: number;
  committed: number;
  outbound: number;
  inTransit: number;
  available: number;
  internalId?: string;
  locationId?: string;
  subRows?: PivotRow[];
}

export const transformToPivot = (flatData: InventoryRow[]): PivotRow[] => {
  const rows = flatData.filter((r) => r.itemCode || r.itemName);
  const grouped = rows.reduce(
    (acc, row) => {
      const width = row.width || row.itemCode?.label || 'Other';
      if (!acc[width]) acc[width] = [];
      acc[width].push(row);
      return acc;
    },
    {} as Record<string, InventoryRow[]>
  );

  return Object.entries(grouped).map(([width, items]) => {
    const subRows: PivotRow[] = items.map((row) => ({
      id: `${width}-${row.length || row.itemCode?.label || row.internalId}`,
      width,
      length: row.length || null,
      isGroupRow: false,
      onHand: parseFloat(row.onHand) || 0,
      committed: parseFloat(row.committed) || 0,
      outbound: parseFloat(row.outbound) || 0,
      inTransit: parseFloat(row.inTransit) || 0,
      available: parseFloat(row.available) || 0,
      internalId: row.internalId,
      locationId: row.locationId,
    }));

    return {
      id: `group-${width}`,
      width,
      length: null,
      isGroupRow: true,
      onHand: subRows.reduce((s, r) => s + r.onHand, 0),
      committed: subRows.reduce((s, r) => s + r.committed, 0),
      outbound: subRows.reduce((s, r) => s + r.outbound, 0),
      inTransit: subRows.reduce((s, r) => s + r.inTransit, 0),
      available: subRows.reduce((s, r) => s + r.available, 0),
      subRows,
    };
  });
};
