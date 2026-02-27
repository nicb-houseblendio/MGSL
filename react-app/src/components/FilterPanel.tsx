import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
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
};

export type FilterOptions = Record<string, { value: string; label: string }[]>;

interface FilterPanelProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onExport: () => void;
  filterOptions?: FilterOptions;
  exportDisabled?: boolean;
}

export const FilterPanel = ({
  filters,
  onFiltersChange,
  onApply,
  onReset,
  onExport,
  filterOptions = {},
  exportDisabled,
}: FilterPanelProps) => {
  const { subsidiaryName } = useNetSuite();
  const config = getBusinessConfig(subsidiaryName);

  const updateFilter = (key: FilterKey, value: string[]) => {
    const apiKey = FILTER_TO_API[key] || key;
    onFiltersChange({
      ...filters,
      [apiKey]: value,
      ...(key === 'location' && { reload: value }),
    });
  };

  const allFilters = config.filters;
  const [filtersOpen, setFiltersOpen] = React.useState(true);

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
          <span className="text-[13px] font-semibold text-[#0F2641]">🔍 Filtres</span>
          {activeFilterCount > 0 && (
            <span
              className="text-white text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: '#1E6B47' }}
            >
              {activeFilterCount} actif{activeFilterCount > 1 ? 's' : ''}
            </span>
          )}
          {!filtersOpen && (
            <span className="text-[#7A8FA3] text-xs">(cliquer pour développer)</span>
          )}
        </div>
        <ChevronDown
          className="w-4 h-4 text-[#7A8FA3] transition-transform"
          style={{ transform: filtersOpen ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {filtersOpen && (
        <div className="px-5 pb-3.5 border-t border-[#E2E8F0]">
          <div className="grid gap-x-3 gap-y-2 mb-3 pt-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))' }}>
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
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Checkbox
                id="qty-toggle"
                checked={filters.quantityGreaterThanZero !== false}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    ...filters,
                    quantityGreaterThanZero: checked !== false,
                  })
                }
              />
              <label htmlFor="qty-toggle" className="text-[13px] font-medium select-none cursor-pointer text-[#3D5166]">
                Quantité &gt; 0 seulement
              </label>
            </div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onReset}
              className="py-1.5 px-4 rounded-md text-xs font-semibold border border-[#CBD5E1] bg-transparent text-[#3D5166] hover:bg-[#F8FAFC]"
            >
              ↺ Réinitialiser
            </button>
            <button
              type="button"
              onClick={onApply}
              className="py-1.5 px-5 rounded-md text-[13px] font-bold text-white border-0 shadow-md"
              style={{ background: 'linear-gradient(135deg, #1E6B47, #237A52)', boxShadow: '0 2px 8px rgba(30,107,71,0.3)' }}
            >
              ▶ Appliquer les filtres
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={exportDisabled}
              className="py-1.5 px-3.5 rounded-md text-xs font-semibold border-2 bg-transparent hover:bg-[#FFFEF5] disabled:opacity-50"
              style={{ borderColor: '#C8A035', color: '#C8A035' }}
            >
              ↓ Export Excel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const COMBOBOX_POC_CLASS =
  'bg-white border-[#CBD5E1] text-[#0D1F33] hover:bg-[#F8FAFC] hover:border-[#94A3B8]';

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
      <label className="text-[10px] font-semibold uppercase tracking-wider text-[#3D5166]">
        {FILTER_LABELS[filterKey] || filterKey}
      </label>
      <MultiSelectCombobox
        options={options}
        selected={selected}
        onChange={(v) => updateFilter(filterKey, v)}
        placeholder={FILTER_LABELS[filterKey] || filterKey}
        searchPlaceholder="Rechercher..."
        className={comboboxClassName}
      />
    </div>
  );
};
