export interface InventoryRow {
  internalId: string;
  locationId: string;
  location: { label: string; url?: string };
  itemName: string | null;
  itemCode: { label: string; url?: string } | null;
  quantity: string;
  onHand: string;
  committed: string;
  onOrder: string;
  inTransit: string;
  available: string;
  outbound: string;
  averageCost: string;
  width?: string;
  length?: string;
  grade?: string;
}

export interface ItemsResponse {
  rows: InventoryRow[];
  totals: {
    onHand: number;
    committed: number;
    outbound: number;
    onOrder: number;
    inTransit: number;
    available: number;
  };
  uom: string;
  rowCount: number;
}

export interface DetailRow {
  lotNumber: string;
  documentType: string;
  documentNumber: string;
  documentLink: string;
  [key: string]: unknown;
}

export interface DetailResponse {
  rows: DetailRow[];
  columns: { id: string; label: string }[];
}

export interface FilterState {
  subsidiary?: string[];
  location?: string[];
  reload?: string[];
  item?: string[];
  species?: string[];
  thickness?: string[];
  width?: string[];
  length?: string[];
  grade?: string[];
  supplier?: string[];
  finition?: string[];
  humidity?: string[];
  plannage?: string[];
  etampage?: string[];
  autres?: string[];
  category?: string[];
  quantityGreaterThanZero?: boolean;
}

export interface NetSuiteContext {
  userId: string;
  userName: string;
  subsidiaryId: string;
  subsidiaryName: string;
  accountId: string;
  restletUrl: string;
}
