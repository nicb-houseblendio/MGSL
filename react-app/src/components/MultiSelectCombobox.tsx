import * as React from 'react';
import { ChevronsUpDown, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectComboboxProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

export const MultiSelectCombobox = ({
  options,
  selected,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  loading = false,
  disabled = false,
  className,
}: MultiSelectComboboxProps) => {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options;
    const s = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(s) ||
        o.value.toLowerCase().includes(s)
    );
  }, [options, search]);

  const toggleValue = (value: string) => {
    const newSelected = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(newSelected);
  };

  const clearAll = () => {
    onChange([]);
  };

  const selectedLabels = selected
    .map((v) => options.find((o) => o.value === v)?.label || v)
    .filter(Boolean);

  const tooltipText = selectedLabels.length > 0 ? selectedLabels.join(', ') : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          title={tooltipText}
          className={cn(
            'w-full min-w-[160px] justify-between font-normal overflow-hidden',
            !selected.length && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">
            {selected.length === 0
              ? placeholder
              : selected.length === 1
                ? selectedLabels[0]
                : `${selected.length} selected`}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {selected.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                className="inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-destructive/20 cursor-pointer"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clearAll();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    clearAll();
                  }
                }}
              >
                <X className="h-3.5 w-3.5 opacity-70 hover:opacity-100" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] min-w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command
          shouldFilter={false}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              setOpen(false);
            }
          }}
        >
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => toggleValue(option.value)}
                  title={option.label}
                  className="truncate"
                >
                  <Checkbox
                    checked={selected.includes(option.value)}
                    className="mr-2 h-4 w-4 shrink-0 pointer-events-none"
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1 p-2 border-t">
            {selectedLabels.slice(0, 3).map((label, i) => (
              <Badge
                key={selected[i]}
                variant="secondary"
                className="text-xs"
              >
                {label}
                <button
                  type="button"
                  className="ml-1 rounded-full hover:bg-muted"
                  onClick={() => toggleValue(selected[i])}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {selected.length > 3 && (
              <Badge variant="outline">+{selected.length - 3}</Badge>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
