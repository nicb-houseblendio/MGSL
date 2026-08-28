export type FilterKey =
  | 'location'
  | 'item'
  | 'species'
  | 'thickness'
  | 'width'
  | 'length'
  | 'grade'
  | 'supplier'
  | 'finish'
  | 'moisture'
  | 'planing'
  | 'stamping'
  | 'other'
  | 'category'
  | 'country'
  | 'vendor'
  | 'po'
  | 'containerNo';

export interface BusinessConfig {
  filters: FilterKey[];
  columns: string[];
}

export const BUSINESS_CONFIG: Record<string, BusinessConfig> = {
  CWP_MTL: {
    filters: ['country', 'vendor', 'po', 'location', 'item', 'thickness', 'width', 'length', 'grade'],
    columns: ['width', 'length', 'onHand', 'committed', 'outbound', 'inTransit', 'available'],
  },
  CWP_IND: {
    filters: [
      'location',
      'item',
      'species',
      'thickness',
      'width',
      'length',
      'grade',
      'finish',
      'moisture',
      'planing',
      'stamping',
      'other',
    ],
    columns: ['width', 'length', 'onHand', 'committed', 'outbound', 'inTransit', 'available'],
  },
  // Hardwood: no width/length columns (variable within a bundle — that is what the
  // tally is for) and no packs.
  //
  // NO CONTAINER FILTER, removed 2026-08-19. It was going to be fed from the
  // lot-number prefix, and Marc-Antoine confirmed that prefix is the PO number,
  // not the container; a container can also span several POs, so the two are not
  // derivable from each other. Container survives on the lot detail tables only.
  // A PO filter is NOT its replacement — the row would need a `pos` option list
  // first, and nobody has asked for one.
  // NO GRADE FILTER, removed 2026-08-27 at Philippe's request, and the code
  // agrees with him: it was filtering on a value that is empty by construction.
  //
  // The builder hard-codes `grade: ''` on every ARCH row, so the filter could
  // never match anything and only offered an empty dropdown.
  //
  // ⚠️ CORRECTED 2026-08-28. The first version of this comment said `cseggrade`
  // "does NOT exist on the item record, it is a column on TRANSACTIONLINE". That
  // was FALSE. It was copied from a stale comment in the cache builder without
  // being checked, and it went out to the client as the reason Grade could never
  // be sourced. Measured: `SELECT COUNT(*) FROM item WHERE cseggrade IS NOT NULL`
  // returns 539. The field exists and MGSL already populate it on 539 items. It
  // is simply NULL on the six ARCH SKUs.
  //
  // So removing the FILTER is still right — an empty dropdown is useless — but
  // the reason is MISSING DATA, not an impossible field.
  //
  // ⚠️ This does NOT contradict Marc-Antoine. He said « Grade : ok, je garde la
  // colonne » on 2026-08-19 and that he would put grade « sur l'item ». He was
  // talking about the COLUMN; Philippe asked about the FILTER; and the ARCH grid
  // has no Grade column today either way (zero references in
  // InventoryTableARCH.tsx). The moment ARCH items carry `cseggrade`, the builder
  // can select it and both the column and this filter become real. Re-add then.
  //
  // MTL and IND keep their own 'grade' entries above, deliberately untouched:
  // FilterPanel is shared with both in production.
  CWP_ARCH: {
    filters: ['location', 'species', 'thickness', 'category'],
    columns: [
      'available',
      'onHand',
      'reserve',
      'readyToBuild',
      'inTransit',
      'onOrder',
    ],
  },
};

export const getBusinessConfig = (subsidiaryName: string): BusinessConfig => {
  const key = subsidiaryName?.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_') || '';
  const match = Object.keys(BUSINESS_CONFIG).find(
    (k) => key.includes(k) || k.includes(key)
  );
  return BUSINESS_CONFIG[match || 'CWP_IND'] || BUSINESS_CONFIG.CWP_IND;
};
