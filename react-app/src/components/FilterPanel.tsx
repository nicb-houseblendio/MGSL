import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { MultiSelectCombobox } from '@/components/MultiSelectCombobox';
import { useNetSuite } from '@/context/NetSuiteContext';
import { getBusinessConfig } from '@/config/businessConfig';
import type { FilterState } from '@/types';
import type { FilterKey } from '@/config/businessConfig';

const FILTER_LABELS: Record<string, string> = {
  location: 'LOCATION',
  item: 'ITEM',
  species: 'SPECIES',
  thickness: 'THICKNESS',
  width: 'WIDTH',
  length: 'LENGTH',
  grade: 'GRADE',
  finish: 'FINISH',
  moisture: 'HUMIDITY',
  planing: 'PLANING',
  stamping: 'STAMPING',
  other: 'OTHER',
  category: 'CATEGORY',
  supplier: 'SUPPLIER',
  country: 'COUNTRY',
  vendor: 'VENDOR',
  po: 'PO',
  containerNo: 'CONTAINER #',
};

const FILTER_PLACEHOLDERS: Record<string, string> = {
  location: 'All locations',
  vendor: 'All vendors',
  po: 'All POs',
  containerNo: 'All containers',
};

const FILTER_TO_API: Record<string, string> = {
  location: 'location',
  item: 'item',
  species: 'species',
  thickness: 'thickness',
  width: 'width',
  length: 'length',
  grade: 'grade',
  supplier: 'supplier',
  finish: 'finition',
  moisture: 'humidity',
  planing: 'plannage',
  stamping: 'etampage',
  other: 'autres',
  category: 'category',
  country: 'country',
  vendor: 'vendor',
  po: 'po',
  containerNo: 'containerNo',
};

export type FilterOptions = Record<string, { value: string; label: string }[]>;

interface FilterPanelProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onReset: () => void;
  onExport: () => void;
  filterOptions?: FilterOptions;
  exportDisabled?: boolean;
  onPriceList?: () => void;
  activeView?: string;
  openTrigger?: number;
  /** Start expanded. ARCH only — the prototype shows its filters open. */
  defaultOpen?: boolean;
}

export const FilterPanel = ({
  filters,
  onFiltersChange,
  onReset,
  onExport,
  filterOptions = {},
  exportDisabled,
  onPriceList,
  activeView,
  openTrigger,
  defaultOpen = false,
}: FilterPanelProps) => {
  const { subsidiaryName } = useNetSuite();
  const config = getBusinessConfig(activeView || subsidiaryName);

  const updateFilter = (key: FilterKey, value: string[]) => {
    const apiKey = FILTER_TO_API[key] || key;
    onFiltersChange({
      ...filters,
      [apiKey]: value,
      ...(key === 'location' && { reload: value }),
    });
  };

  const allFilters = config.filters;
  const [filtersOpen, setFiltersOpen] = React.useState(defaultOpen);

  React.useEffect(() => {
    if (openTrigger && openTrigger > 0) setFiltersOpen(true);
  }, [openTrigger]);

  const activeFilterCount = allFilters.filter((key) => {
    const apiKey = FILTER_TO_API[key] || key;
    const val = key === 'location' ? filters.reload || filters.location : filters[apiKey as keyof FilterState];
    return Array.isArray(val) && val.length > 0;
  }).length;

  return (
    <div
      className="rounded-lg border border-[#E2E8F0] overflow-hidden"
      style={{ background: filtersOpen ? '#FFFFFF' : '#EEF1F6', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
    >
      <button
        type="button"
        onClick={() => setFiltersOpen((o) => !o)}
        className="w-full flex items-center justify-between py-2 px-5 cursor-pointer select-none text-left"
        style={{ background: filtersOpen ? 'transparent' : '#EEF1F6' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-[#0F2641]">Filters</span>
          {activeFilterCount > 0 && (
            <span
              className="text-white text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#1E6B47' }}
            >
              {activeFilterCount} active
            </span>
          )}
          {!filtersOpen && (
            <span className="text-[#7A8FA3] text-xs">(click to expand)</span>
          )}
        </div>
        <ChevronDown
          className="w-4 h-4 text-[#7A8FA3] transition-transform"
          style={{ transform: filtersOpen ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      <div
        style={{
          display: 'grid',
          gridTemplateRows: filtersOpen ? '1fr' : '0fr',
        }}
      >
        <div
          className="overflow-hidden"
          aria-hidden={!filtersOpen}
          style={{ pointerEvents: filtersOpen ? 'auto' : 'none' }}
        >
          <div className="px-5 pb-3.5 border-t border-[#E2E8F0]">
            <div className="flex gap-3 pt-3">
              <div className="grid flex-1 gap-x-3 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {allFilters.map((key) => (
                  <FilterField
                    key={key}
                    filterKey={key}
                    filters={filters}
                    updateFilter={updateFilter}
                    options={filterOptions[FILTER_TO_API[key] || key] || filterOptions[key] || []}
                    comboboxClassName={COMBOBOX_POC_CLASS}
                  />
                ))}
              </div>
              <div className="flex items-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onReset}
                  title="Reset"
                  className="h-10 px-3 rounded-md text-lg font-semibold border border-[#CBD5E1] bg-transparent text-[#3D5166] hover:bg-[#F8FAFC]"
                >
                  ↺
                </button>
                <button
                  type="button"
                  onClick={onExport}
                  disabled={exportDisabled}
                  title="Export Excel"
                  className="h-10 px-3 rounded-md text-lg font-extrabold border-2 bg-transparent hover:bg-[#FFFEF5] disabled:opacity-50"
                  style={{ borderColor: '#C8A035', color: '#C8A035' }}
                >
                  ↓
                </button>
                {onPriceList && (
                  <button
                    type="button"
                    onClick={onPriceList}
                    title="Price List"
                    className="h-10 px-3 rounded-md text-xs font-semibold border border-[#CBD5E1] bg-transparent text-[#3D5166] hover:bg-[#F8FAFC] whitespace-nowrap"
                  >
                    📄 Price List
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const COMBOBOX_POC_CLASS =
  'bg-white border-[#CBD5E1] text-[#0D1F33] hover:bg-[#EDF1F7]';

interface FilterFieldProps {
  filterKey: FilterKey;
  filters: FilterState;
  updateFilter: (key: FilterKey, value: string[]) => void;
  options: { value: string; label: string }[];
  comboboxClassName?: string;
}

const FilterField = ({ filterKey, filters, updateFilter, options, comboboxClassName }: FilterFieldProps) => {
  const apiKey = FILTER_TO_API[filterKey] || filterKey;
  const selected = ((filterKey === 'location' ? filters.reload || filters.location : filters[apiKey as keyof FilterState]) as string[]) || [];

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-wider text-[#3D5166]">
        {FILTER_LABELS[filterKey] || filterKey}
      </label>
      <MultiSelectCombobox
        options={options}
        selected={selected}
        onChange={(v) => updateFilter(filterKey, v)}
        placeholder={FILTER_PLACEHOLDERS[filterKey] || 'All'}
        searchPlaceholder="Search..."
        className={comboboxClassName}
      />
    </div>
  );
};
