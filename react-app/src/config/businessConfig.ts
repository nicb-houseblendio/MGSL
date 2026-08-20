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
  CWP_ARCH: {
    filters: ['location', 'species', 'thickness', 'category', 'grade'],
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
