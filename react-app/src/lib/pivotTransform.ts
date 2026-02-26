import type { SummaryRow } from '@/lib/api';

export interface PivotRow {
  id: string;
  width: string;
  length: string | null;
  isGroupRow: boolean;
  onHand: number;
  committed: number;
  outbound: number;
  onOrder?: number;
  inTransit: number;
  available: number;
  averageCost?: number;
  internalId?: string;
  locationId?: string;
  locationName?: string;
  itemCode?: string;
  itemName?: string;
  itemUrl?: string;
  locationUrl?: string;
  species?: string;
  thickness?: string;
  grade?: string;
  finition?: string;
  humidity?: string;
  plannage?: string;
  etampage?: string;
  autres?: string;
  detailKey?: string;
  subRows?: PivotRow[];
}

export const transformToPivot = (flatData: SummaryRow[]): PivotRow[] => {
  const rows = flatData.filter((r) => r.itemCode || r.itemName);
  const grouped = rows.reduce(
    (acc, row) => {
      const width = row.width || row.itemCode || 'Other';
      if (!acc[width]) acc[width] = [];
      acc[width].push(row);
      return acc;
    },
    {} as Record<string, SummaryRow[]>
  );

  return Object.entries(grouped).map(([width, items]) => {
    const subRows: PivotRow[] = items.map((row) => ({
      id: `${width}-${row.length || row.itemCode || row.internalId}`,
      width,
      length: row.length || null,
      isGroupRow: false,
      onHand: Number(row.onHand) || 0,
      committed: Number(row.committed) || 0,
      outbound: Number(row.outbound) || 0,
      onOrder: Number(row.onOrder) || 0,
      inTransit: Number(row.inTransit) || 0,
      available: Number(row.available) || 0,
      averageCost: Number(row.averageCost) || 0,
      internalId: row.internalId,
      locationId: row.locationId,
      locationName: row.locationName,
      itemCode: row.itemCode,
      itemName: row.itemName,
      itemUrl: row.itemUrl,
      locationUrl: row.locationUrl,
      species: row.species,
      thickness: row.thickness,
      grade: row.grade,
      finition: row.finition,
      humidity: row.humidity,
      plannage: row.plannage,
      etampage: row.etampage,
      autres: row.autres,
      detailKey: row.detailKey,
    }));

    return {
      id: `group-${width}`,
      width,
      length: null,
      isGroupRow: true,
      onHand: subRows.reduce((s, r) => s + r.onHand, 0),
      committed: subRows.reduce((s, r) => s + r.committed, 0),
      outbound: subRows.reduce((s, r) => s + r.outbound, 0),
      onOrder: subRows.reduce((s, r) => s + (r.onOrder || 0), 0),
      inTransit: subRows.reduce((s, r) => s + r.inTransit, 0),
      available: subRows.reduce((s, r) => s + r.available, 0),
      averageCost: subRows.length ? subRows.reduce((s, r) => s + (r.averageCost || 0), 0) / subRows.length : 0,
      subRows,
    };
  });
};
