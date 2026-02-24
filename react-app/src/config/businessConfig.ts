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
  | 'category';

export interface BusinessConfig {
  filters: FilterKey[];
  columns: string[];
}

export const BUSINESS_CONFIG: Record<string, BusinessConfig> = {
  CWP_MTL: {
    filters: ['location', 'thickness', 'width', 'length', 'grade', 'supplier'],
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
  CWP_ARCH: {
    filters: ['location', 'species', 'thickness', 'category'],
    columns: ['width', 'length', 'onHand', 'committed', 'outbound', 'inTransit', 'available'],
  },
};

export const getBusinessConfig = (subsidiaryName: string): BusinessConfig => {
  const key = subsidiaryName?.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_') || '';
  const match = Object.keys(BUSINESS_CONFIG).find(
    (k) => key.includes(k) || k.includes(key)
  );
  return BUSINESS_CONFIG[match || 'CWP_IND'] || BUSINESS_CONFIG.CWP_IND;
};
