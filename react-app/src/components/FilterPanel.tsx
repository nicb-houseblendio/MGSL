import * as React from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { MultiSelectCombobox } from '@/components/MultiSelectCombobox';
import { useNetSuite } from '@/context/NetSuiteContext';
import { getBusinessConfig } from '@/config/businessConfig';
import type { FilterState } from '@/types';
import type { FilterKey } from '@/config/businessConfig';

const FILTER_LABELS: Record<string, string> = {
  location: 'Location',
  item: 'Item',
  species: 'Species',
  thickness: 'Thickness',
  width: 'Width',
  length: 'Length',
  grade: 'Grade',
  supplier: 'Supplier',
  finish: 'Finish',
  moisture: 'Moisture',
  planing: 'Planing',
  stamping: 'Stamping',
  other: 'Other',
  category: 'Category',
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
  filterOptions?: FilterOptions;
}

export const FilterPanel = ({
  filters,
  onFiltersChange,
  onApply,
  onReset,
  filterOptions = {},
}: FilterPanelProps) => {
  const { subsidiaryName } = useNetSuite();
  const config = getBusinessConfig(subsidiaryName);
  const [primaryOpen, setPrimaryOpen] = React.useState(true);
  const [attributesOpen, setAttributesOpen] = React.useState(false);

  const updateFilter = (key: FilterKey, value: string[]) => {
    const apiKey = FILTER_TO_API[key] || key;
    onFiltersChange({
      ...filters,
      [apiKey]: value,
      ...(key === 'location' && { reload: value }),
    });
  };

  const primaryFilters = config.filters.slice(0, 4);
  const attributeFilters = config.filters.slice(4);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex gap-2">
          <Button onClick={onApply}>Apply Filters</Button>
          <Button variant="outline" onClick={onReset}>
            Reset Filters
          </Button>
        </div>
      </div>

      <Collapsible open={primaryOpen} onOpenChange={setPrimaryOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 w-full py-2 text-left font-medium">
            {primaryOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Primary Filters
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 py-4">
            {primaryFilters.map((key) => (
              <FilterField
                key={key}
                filterKey={key}
                filters={filters}
                updateFilter={updateFilter}
                options={filterOptions[FILTER_TO_API[key] || key] || filterOptions[key] || []}
              />
            ))}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="qty-greater"
                checked={filters.quantityGreaterThanZero !== false}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    ...filters,
                    quantityGreaterThanZero: checked !== false,
                  })
                }
              />
              <label
                htmlFor="qty-greater"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Quantity greater than 0
              </label>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {attributeFilters.length > 0 && (
        <Collapsible open={attributesOpen} onOpenChange={setAttributesOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 w-full py-2 text-left font-medium">
              {attributesOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Item Attributes
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 py-4">
              {attributeFilters.map((key) => (
                <FilterField
                  key={key}
                  filterKey={key}
                  filters={filters}
                  updateFilter={updateFilter}
                  options={filterOptions[FILTER_TO_API[key] || key] || filterOptions[key] || []}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};

interface FilterFieldProps {
  filterKey: FilterKey;
  filters: FilterState;
  updateFilter: (key: FilterKey, value: string[]) => void;
  options: { value: string; label: string }[];
}

const FilterField = ({
  filterKey,
  filters,
  updateFilter,
  options,
}: FilterFieldProps) => {
  const apiKey = FILTER_TO_API[filterKey] || filterKey;
  const selected = ((filterKey === 'location' ? filters.reload || filters.location : filters[apiKey as keyof FilterState]) as string[]) || [];

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{FILTER_LABELS[filterKey] || filterKey}</label>
      <MultiSelectCombobox
        options={options}
        selected={selected}
        onChange={(v) => updateFilter(filterKey, v)}
        placeholder={`Select ${FILTER_LABELS[filterKey] || filterKey}`}
        searchPlaceholder="Search..."
      />
    </div>
  );
};
