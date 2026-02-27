import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FileDown, RotateCcw, Filter } from 'lucide-react';
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

  const row1Filters = config.filters.slice(0, 5);
  const row2Filters = config.filters.slice(5);

  return (
    <div className="bg-background rounded-lg border border-border/60 p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground/60 mb-1">
        <Filter className="h-3.5 w-3.5" />
        Filtres
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {row1Filters.map((key) => (
          <FilterField
            key={key}
            filterKey={key}
            filters={filters}
            updateFilter={updateFilter}
            options={filterOptions[FILTER_TO_API[key] || key] || filterOptions[key] || []}
          />
        ))}
      </div>

      {row2Filters.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {row2Filters.map((key) => (
            <FilterField
              key={key}
              filterKey={key}
              filters={filters}
              updateFilter={updateFilter}
              options={filterOptions[FILTER_TO_API[key] || key] || filterOptions[key] || []}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border/40">
        <div className="flex items-center space-x-2">
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
          <label htmlFor="qty-toggle" className="text-xs font-medium select-none cursor-pointer">
            Quantit&eacute; &gt; 0 seulement
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReset} className="text-xs">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            R&eacute;initialiser
          </Button>
          <Button size="sm" onClick={onApply} className="bg-green text-white hover:bg-green/90 text-xs">
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            Appliquer les filtres
          </Button>
          <Button variant="outline" size="sm" onClick={onExport} disabled={exportDisabled} className="text-xs">
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Export Excel
          </Button>
        </div>
      </div>
    </div>
  );
};

interface FilterFieldProps {
  filterKey: FilterKey;
  filters: FilterState;
  updateFilter: (key: FilterKey, value: string[]) => void;
  options: { value: string; label: string }[];
}

const FilterField = ({ filterKey, filters, updateFilter, options }: FilterFieldProps) => {
  const apiKey = FILTER_TO_API[filterKey] || filterKey;
  const selected = ((filterKey === 'location' ? filters.reload || filters.location : filters[apiKey as keyof FilterState]) as string[]) || [];

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50">
        {FILTER_LABELS[filterKey] || filterKey}
      </label>
      <MultiSelectCombobox
        options={options}
        selected={selected}
        onChange={(v) => updateFilter(filterKey, v)}
        placeholder={FILTER_LABELS[filterKey] || filterKey}
        searchPlaceholder="Rechercher..."
      />
    </div>
  );
};
