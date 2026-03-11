
# MGSL Trader Screen — Part 6: Frontend Components Code

> **Purpose:** This is Part 6 of the multi-part context package. It contains the full verbatim source code of all React component files. These are the UI building blocks that render the trader screen interface. UI primitive files (button.tsx, checkbox.tsx, etc. from shadcn/Radix) are excluded — they are standard library components.

---

## Component File Index

| File | Lines | Purpose |
|---|---|---|
| `App.tsx` | 307 | Main app component — header, CWP pills, UoM selector, tab bar, layout orchestration |
| `InventoryTable.tsx` | 441 | TanStack Table data grid + InventoryFooter fixed bar |
| `FilterPanel.tsx` | 209 | Collapsible filter panel with multi-select comboboxes |
| `DetailDrawer.tsx` | 189 | Side drawer (Sheet) for transaction-level drill-down |
| `CreateOrderModal.tsx` | 168 | Dialog for creating PO/SO records |
| `OrderPopover.tsx` | 66 | $ button popover offering PO/SO choice |
| `MultiSelectCombobox.tsx` | 165 | Reusable multi-select with search, badges, clear |
| `ThemeToggle.tsx` | 30 | Light/dark/system theme toggle dropdown |

---

## 1. App.tsx

**Path:** `react-app/src/App.tsx`

This is the root content component. It orchestrates the entire trader screen layout:
- Gradient header with MG logo, CWP view pills, UoM selector, date, refresh button
- Tab bar (Inventaire / Vues sauvegardées — saved views tab is non-functional)
- New version banner (from refresh state machine)
- Filter panel
- Main inventory table area with loading spinner
- Fixed footer with totals
- Detail drawer (side panel for drill-down)

**Key observations:**
- CWP view pills (`activeView` state) currently only change the UoM dropdown options — they do NOT filter the data
- UoM selector (`uom` state) is stored but never passed to the table or used for conversion
- `defaultFilters` has `quantityGreaterThanZero: true` — rows with all-zero quantities hidden by default
- `handleApply` creates a shallow copy of filters (triggers re-render) but doesn't call the API
- The refresh state machine polls for new cache versions via meta endpoint

```tsx
import * as React from 'react';
import { ThemeProvider } from '@/context/ThemeProvider';
import { NetSuiteProvider, useNetSuite } from '@/context/NetSuiteContext';
import { FilterPanel } from '@/components/FilterPanel';
import { InventoryTable, InventoryFooter } from '@/components/InventoryTable';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useSummaryData } from '@/hooks/useSummaryData';
import { useRefreshState } from '@/hooks/useRefreshState';
import { exportToExcel } from '@/lib/export';
import type { FilterState } from '@/types';
import type { SummaryRow } from '@/lib/api';
import type { DetailType } from '@/hooks/useDetailData';

const DEFAULT_UOM_CONFIG: Record<string, string[]> = {
  'CWP IND': ['MBF', 'Packs'],
  'CWP MTL': ['MBF', 'Packs', 'TL'],
  'CWP ARCH': ['MBF', 'Cubic meters (m³)', 'Packs'],
};

const defaultFilters: FilterState = {
  quantityGreaterThanZero: true,
};

function TraderScreenContent() {
  const { subsidiaryId, uomConfig: contextUomConfig } = useNetSuite();
  const uomConfig = contextUomConfig && Object.keys(contextUomConfig).length > 0
    ? contextUomConfig
    : DEFAULT_UOM_CONFIG;
  const CWP_VIEWS = Object.keys(uomConfig);
  const {
    allRows,
    meta,
    loading,
    error,
    fetchSummary,
    getFilteredRows,
    getTotals,
    getFilterOptions,
  } = useSummaryData(subsidiaryId || 'default');

  const {
    refreshState,
    newVersionAvailable,
    error: refreshError,
    doRefresh,
    dismissBanner,
  } = useRefreshState({
    loadedCacheVersion: meta?.cacheVersion ?? null,
    lastUpdated: meta?.lastUpdated ?? null,
    onFetchNeeded: async () => { await fetchSummary(); },
    onFetchComplete: () => {},
  });

  const [activeView, setActiveView] = React.useState(CWP_VIEWS[0] || 'CWP IND');
  const [uom, setUom] = React.useState('Packs');
  const [filters, setFilters] = React.useState<FilterState>(defaultFilters);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailParams, setDetailParams] = React.useState<{
    itemId: string;
    locationId: string;
    type: DetailType;
  } | null>(null);

  const filteredRows = React.useMemo(
    () => getFilteredRows(filters),
    [getFilteredRows, filters]
  );

  const totals = React.useMemo(
    () => getTotals(filteredRows),
    [getTotals, filteredRows]
  );

  const filterOptions = React.useMemo(
    () => getFilterOptions(allRows),
    [getFilterOptions, allRows]
  );

  const avgCost = React.useMemo(() => {
    if (!filteredRows.length) return 0;
    const sum = filteredRows.reduce((s, r) => s + (r.averageCost || 0), 0);
    return sum / filteredRows.length;
  }, [filteredRows]);

  const handleApply = React.useCallback(() => {
    setFilters((f) => ({ ...f }));
  }, []);

  const handleReset = React.useCallback(() => {
    setFilters(defaultFilters);
  }, []);

  const handleDrillDown = React.useCallback(
    (type: DetailType, row: SummaryRow) => {
      if (row.internalId && row.locationId) {
        setDetailParams({
          itemId: row.internalId,
          locationId: row.locationId,
          type,
        });
        setDetailOpen(true);
      }
    },
    []
  );

  const handleExport = React.useCallback(() => {
    exportToExcel(filteredRows, totals);
  }, [filteredRows, totals]);

  const displayError = error || refreshError;

  const today = typeof window !== 'undefined' ? new Date().toLocaleDateString('fr-CA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const uomOptions = uomConfig[activeView] || ['MBF', 'Packs'];

  return (
    <div className="min-h-screen flex flex-col text-foreground pb-10" style={{ background: 'var(--background)' }}>
      {/* POC-style header: gradient 56px, MG logo, two-line branding, CWP pills, UoM + date */}
      <header
        className="sticky top-0 z-30 text-white flex-shrink-0 shadow-lg"
        style={{
          background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 60%, var(--navy-light) 100%)',
          height: 56,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md"
              style={{ background: 'linear-gradient(135deg, var(--green), #2A9060)' }}
            >
              <span className="text-white text-sm font-extrabold tracking-tight">MG</span>
            </div>
            <div>
              <div className="text-white text-[15px] font-bold tracking-wide">MGSL</div>
              <div className="text-white/50 text-[10px] uppercase tracking-widest">Commodity Group</div>
            </div>
          </div>
          <div className="w-px h-7 bg-white/15" />
          <div className="text-white/85 text-[13px] font-medium">Trader Screen</div>
        </div>

        <div className="flex gap-1">
          {CWP_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setActiveView(view)}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all"
              style={{
                background: activeView === view ? 'linear-gradient(135deg, var(--green), #237A52)' : 'rgba(255,255,255,0.1)',
                color: activeView === view ? '#fff' : 'rgba(255,255,255,0.65)',
                boxShadow: activeView === view ? '0 2px 8px rgba(0,0,0,0.25)' : 'none',
              }}
            >
              {view}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-white/45 text-[11px] uppercase tracking-wider">UoM</span>
            <select
              value={uomOptions.includes(uom) ? uom : uomOptions[0]}
              onChange={(e) => setUom(e.target.value)}
              className="py-1 px-2.5 rounded-md text-white text-xs cursor-pointer outline-none border border-white/25 bg-white/10"
            >
              {uomOptions.map((o) => (
                <option key={o} value={o} className="bg-navy text-white">{o}</option>
              ))}
            </select>
          </div>
          <div className="w-px h-5 bg-white/15" />
          <span className="text-white/40 text-[11px]">{today}</span>
          <div className="w-px h-5 bg-white/15" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void doRefresh()}
            disabled={refreshState === 'checking' || refreshState === 'fetching'}
            className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${(refreshState === 'checking' || refreshState === 'fetching') ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      {/* POC-style tabs: navyMid bg, Inventaire / Vues sauvegardées */}
      <div className="flex gap-0.5 px-6 flex-shrink-0" style={{ background: 'var(--navy-mid)', paddingTop: 0, paddingBottom: 0 }}>
        <button
          type="button"
          className="px-4 py-2 text-xs font-semibold rounded-t-md transition-all text-[var(--navy)]"
          style={{ background: 'var(--background)' }}
        >
          📦  Inventaire
        </button>
        <button
          type="button"
          className="px-4 py-2 text-xs font-semibold rounded-t-md transition-all text-white/60 hover:text-white/80 hover:bg-white/5"
        >
          ⭐  Vues sauvegardées
        </button>
      </div>

      {/* New version banner */}
      {newVersionAvailable && (
        <div className="flex items-center justify-between bg-green/10 text-green px-4 py-2 text-sm border-b border-green/20">
          <span>Nouvelles donn&eacute;es disponibles.</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { dismissBanner(); void doRefresh(true); }} className="bg-green text-white hover:bg-green/90 text-xs">
              Charger maintenant
            </Button>
            <Button size="sm" variant="outline" onClick={dismissBanner} className="text-xs">
              Ignorer
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 pt-3">
        <FilterPanel
          filters={filters}
          onFiltersChange={setFilters}
          onApply={handleApply}
          onReset={handleReset}
          onExport={handleExport}
          filterOptions={filterOptions}
          exportDisabled={!allRows}
        />
      </div>

      {/* Error display */}
      {displayError && (
        <div className="px-4 pt-2">
          <p className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded">{displayError}</p>
        </div>
      )}

      {/* Main table area — POC: bg #EEF1F6, loading "Chargement…" with circular spinner */}
      <main className="flex-1 px-4 pt-3 pb-2 min-h-0">
        <div className="relative flex-1">
          {loading && !allRows && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center z-10 rounded backdrop-blur-sm"
              style={{ background: 'rgba(238,241,246,0.88)' }}
            >
              <div
                className="w-11 h-11 rounded-full border-4 border-[#CBD5E1] border-t-[var(--green)] animate-spin"
              />
              <div className="mt-3 text-[13px] font-medium text-[#3D5166]">Chargement…</div>
            </div>
          )}
          {allRows ? (
            <InventoryTable
              data={filteredRows}
              onDrillDown={handleDrillDown}
            />
          ) : !loading ? (
            <p className="py-12 text-center text-sm text-[#3D5166]">
              Chargement des donn&eacute;es d&apos;inventaire…
            </p>
          ) : null}
        </div>
      </main>

      {/* Fixed footer with totals */}
      <InventoryFooter
        rowCount={filteredRows.length}
        totals={totals}
        averageCost={avgCost}
      />

      {/* Detail drawer */}
      {detailParams && (
        <DetailDrawer
          open={detailOpen}
          onOpenChange={setDetailOpen}
          itemId={detailParams.itemId}
          locationId={detailParams.locationId}
          triggerType={detailParams.type}
          resetCacheVersion={meta?.cacheVersion ?? null}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <NetSuiteProvider>
        <TraderScreenContent />
      </NetSuiteProvider>
    </ThemeProvider>
  );
}

export default App;
```

---

## 2. InventoryTable.tsx

**Path:** `react-app/src/components/InventoryTable.tsx`

This file contains two exported components:
1. **`InventoryTable`** — The main data grid using TanStack Table (React Table v8). Defines all 22 columns with sorting, row selection, clickable metric cells, and the $ order button.
2. **`InventoryFooter`** — Fixed bottom bar showing row count and aggregated totals for all quantity metrics plus average price.

**Key observations:**
- 22 columns defined: select checkbox, itemCode, locationName, itemName, species, thickness, width, length, grade, finition, humidity, plannage, etampage, onHand, committed, outbound, onOrder, inTransit, available, averageCost, order ($)
- Column order differs from SDD spec (SDD puts quantity columns before attribute columns)
- `MetricCell` component makes non-zero quantity values clickable for drill-down
- Item ID and Location cells render as clickable links using pre-resolved URLs from the cache
- No row virtualization is active (TanStack Virtual is imported at package level but not used here)
- Footer uses pastel color constants for metric labels (different from main table metric colors)
- Available column shows `+` prefix for positive values, `▼` prefix for negative

```tsx
import * as React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { OrderPopover } from '@/components/OrderPopover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SummaryRow } from '@/lib/api';
import type { DetailType } from '@/hooks/useDetailData';

interface InventoryTableProps {
  data: SummaryRow[];
  onDrillDown?: (type: DetailType, row: SummaryRow) => void;
}

const formatNum = (n: number) =>
  n === 0 ? '0' : Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatCurrency = (n: number) =>
  n === 0 ? '$0.00' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface MetricCellProps {
  value: number;
  row: SummaryRow;
  type: DetailType;
  colorClass: string;
  prefix?: string;
  onDrillDown?: (type: DetailType, row: SummaryRow) => void;
}

const MetricCell = ({ value, row, type, colorClass, prefix, onDrillDown }: MetricCellProps) => {
  const canDrill = onDrillDown && row.internalId && row.locationId;
  const display = `${prefix || ''}${formatNum(value)}`;

  if (canDrill && value !== 0) {
    return (
      <button
        type="button"
        onClick={() => onDrillDown(type, row)}
        className={`${colorClass} hover:underline font-medium tabular-nums text-right w-full block`}
      >
        {display}
      </button>
    );
  }
  return <span className={`${colorClass} tabular-nums text-right block`}>{display}</span>;
};

const SortHeader = ({ label, column }: { label: string; column: { getIsSorted: () => false | 'asc' | 'desc'; getToggleSortingHandler: () => ((event: unknown) => void) | undefined } }) => {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-white/90 select-none"
      onClick={column.getToggleSortingHandler()}
    >
      {label}
      {sorted === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
};

export const InventoryTable = ({ data, onDrillDown }: InventoryTableProps) => {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});

  const columns = React.useMemo<ColumnDef<SummaryRow>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
            className="border-white/50"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        size: 36,
        enableSorting: false,
      },
      {
        accessorKey: 'itemCode',
        header: ({ column }) => <SortHeader label="ITEM ID" column={column} />,
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          const url = row.original.itemUrl;
          if (url && v) {
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline font-mono text-xs">
                {v}
              </a>
            );
          }
          return <span className="font-mono text-xs">{v || '—'}</span>;
        },
        size: 130,
      },
      {
        accessorKey: 'locationName',
        header: ({ column }) => <SortHeader label="LOCATION" column={column} />,
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          const url = row.original.locationUrl;
          if (url && v) {
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline text-xs">
                {v}
              </a>
            );
          }
          return <span className="text-xs">{v || '—'}</span>;
        },
        size: 120,
      },
      {
        accessorKey: 'itemName',
        header: ({ column }) => <SortHeader label="ITEM" column={column} />,
        cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '—'}</span>,
        size: 220,
      },
      {
        accessorKey: 'species',
        header: ({ column }) => <SortHeader label="SPECIES" column={column} />,
        cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'thickness',
        header: ({ column }) => <SortHeader label="THICKNESS" column={column} />,
        cell: ({ getValue }) => <span className="text-xs font-mono">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'width',
        header: ({ column }) => <SortHeader label="WIDTH" column={column} />,
        cell: ({ getValue }) => <span className="text-xs font-mono">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'length',
        header: ({ column }) => <SortHeader label="LENGTH" column={column} />,
        cell: ({ getValue }) => <span className="text-xs font-mono">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'grade',
        header: ({ column }) => <SortHeader label="GRADE" column={column} />,
        cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'finition',
        header: ({ column }) => <SortHeader label="FINISH" column={column} />,
        cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'humidity',
        header: ({ column }) => <SortHeader label="HUMIDITY" column={column} />,
        cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'plannage',
        header: ({ column }) => <SortHeader label="PLANING" column={column} />,
        cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'etampage',
        header: ({ column }) => <SortHeader label="STAMPING" column={column} />,
        cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '—'}</span>,
        size: 90,
      },
      {
        accessorKey: 'onHand',
        header: ({ column }) => <SortHeader label="ON HAND" column={column} />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={getValue() as number}
            row={row.original}
            type="onHand"
            colorClass="text-metric-onhand"
            onDrillDown={onDrillDown}
          />
        ),
        size: 95,
      },
      {
        accessorKey: 'committed',
        header: ({ column }) => <SortHeader label="COMMITTED" column={column} />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={getValue() as number}
            row={row.original}
            type="committed"
            colorClass="text-metric-committed"
            onDrillDown={onDrillDown}
          />
        ),
        size: 95,
      },
      {
        accessorKey: 'outbound',
        header: ({ column }) => <SortHeader label="OUTBOUND" column={column} />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={getValue() as number}
            row={row.original}
            type="outbound"
            colorClass="text-metric-outbound"
            onDrillDown={onDrillDown}
          />
        ),
        size: 95,
      },
      {
        accessorKey: 'onOrder',
        header: ({ column }) => <SortHeader label="ON ORDER" column={column} />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={(getValue() as number) ?? 0}
            row={row.original}
            type="onOrder"
            colorClass="text-metric-onorder"
            onDrillDown={onDrillDown}
          />
        ),
        size: 95,
      },
      {
        accessorKey: 'inTransit',
        header: ({ column }) => <SortHeader label="IN TRANSIT" column={column} />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={getValue() as number}
            row={row.original}
            type="inTransit"
            colorClass="text-metric-intransit"
            onDrillDown={onDrillDown}
          />
        ),
        size: 100,
      },
      {
        accessorKey: 'available',
        header: ({ column }) => <SortHeader label="AVAILABLE" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span className="text-metric-onhand font-medium tabular-nums text-right block">
              {v > 0 ? '+' : ''}{formatNum(v)}
            </span>
          );
        },
        size: 100,
      },
      {
        accessorKey: 'averageCost',
        header: 'AVG PRIX/M\u00B3',
        cell: ({ getValue }) => (
          <span className="tabular-nums font-mono text-xs text-right block">{formatCurrency(getValue() as number)}</span>
        ),
        size: 115,
        enableSorting: false,
      },
      {
        id: 'order',
        header: () => <span className="text-gold">$</span>,
        cell: ({ row }) =>
          row.original.internalId && row.original.locationId ? (
            <OrderPopover row={row.original} />
          ) : null,
        size: 40,
        enableSorting: false,
      },
    ],
    [onDrillDown]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.detailKey || `${row.internalId}-${row.locationId}`,
  });

  return (
    <div className="rounded-md border border-navy-mid/30 overflow-auto max-h-[calc(100vh-280px)] bg-surface inventory-table-scroll">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="sticky top-0 z-10 text-white border-b-0"
              style={{ background: 'linear-gradient(to bottom, var(--navy), var(--navy-mid))' }}
            >
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-white/80 py-2 px-3"
                  style={{ width: header.getSize() }}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row, i) => (
              <TableRow
                key={row.id}
                className={`${i % 2 === 0 ? 'bg-surface' : 'bg-row-alt'} hover:bg-row-hover transition-colors border-b border-border/50`}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-1.5 px-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                Aucune donnée disponible
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

interface InventoryFooterProps {
  rowCount: number;
  totals: {
    onHand: number;
    committed: number;
    outbound: number;
    onOrder: number;
    inTransit: number;
    available: number;
  };
  averageCost?: number;
}

/* POC footer: label colors for totals row */
const FOOTER_LABEL: Record<string, string> = {
  onHand: '#A5D6A7',
  committed: '#FFB74D',
  outbound: '#F48FB1',
  onOrder: '#90CAF9',
  inTransit: '#CE93D8',
  available: '#A5D6A7',
  availableNeg: '#FCA5A5',
  avgPrice: '#FDD9A0',
};

export const InventoryFooter = ({ rowCount, totals, averageCost }: InventoryFooterProps) => (
  <footer
    className="fixed bottom-0 left-0 right-0 z-30 text-white border-t-2 border-[rgba(200,160,53,0.6)]"
    style={{ background: 'linear-gradient(to right, var(--navy), var(--navy-mid))' }}
  >
    <div className="flex items-center justify-between px-4 py-2.5 text-xs">
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">
        TOTAUX · {rowCount} art.
      </span>
      <div className="flex items-center gap-5">
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: FOOTER_LABEL.onHand }}>ON HAND</span>
          <span className="font-mono text-[13px] font-bold tabular-nums leading-none">{formatNum(totals.onHand)}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: FOOTER_LABEL.committed }}>COMMITTED</span>
          <span className="font-mono text-[13px] font-bold tabular-nums leading-none">{formatNum(totals.committed)}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: FOOTER_LABEL.outbound }}>OUTBOUND</span>
          <span className="font-mono text-[13px] font-bold tabular-nums leading-none">{formatNum(totals.outbound)}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: FOOTER_LABEL.onOrder }}>ON ORDER</span>
          <span className="font-mono text-[13px] font-bold tabular-nums leading-none">{formatNum(totals.onOrder)}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: FOOTER_LABEL.inTransit }}>IN TRANSIT</span>
          <span className="font-mono text-[13px] font-bold tabular-nums leading-none">{formatNum(totals.inTransit)}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: totals.available >= 0 ? FOOTER_LABEL.available : FOOTER_LABEL.availableNeg }}>AVAILABLE</span>
          <span className="font-mono text-[13px] font-bold tabular-nums leading-none" style={{ color: totals.available >= 0 ? FOOTER_LABEL.available : FOOTER_LABEL.availableNeg }}>
            {totals.available >= 0 ? '' : '▼'}{formatNum(Math.abs(totals.available))}
          </span>
        </span>
        {averageCost !== undefined && (
          <span className="flex flex-col items-end gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: FOOTER_LABEL.avgPrice }}>Moy. Prix</span>
            <span className="font-mono text-[13px] font-bold tabular-nums leading-none" style={{ color: FOOTER_LABEL.avgPrice }}>{formatCurrency(averageCost)}</span>
          </span>
        )}
      </div>
    </div>
  </footer>
);
```

---

## 3. FilterPanel.tsx

**Path:** `react-app/src/components/FilterPanel.tsx`

Collapsible filter panel with multi-select comboboxes for each filterable attribute. Uses `businessConfig.ts` to determine which filters to show for the current subsidiary.

**Key observations:**
- Opens expanded by default (`filtersOpen` state = `true`). SDD specifies it should start collapsed.
- `FILTER_TO_API` maps UI filter keys to API/data field names (e.g., `finish` → `finition`, `moisture` → `humidity`)
- Active filter count badge shows in the header
- "Quantité > 0 seulement" checkbox controls `quantityGreaterThanZero` filter
- Apply button triggers `onApply` which just shallow-copies filters (no API call)
- Export Excel button in footer area
- Location filter writes to both `filters.reload` and `filters.location` — unclear purpose of `reload` key

```tsx
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
```

---

## 4. DetailDrawer.tsx

**Path:** `react-app/src/components/DetailDrawer.tsx`

Side drawer (using Radix Sheet) that shows transaction-level detail when a user clicks on a quantity cell. Contains 5 tabs (On Hand, Committed, Outbound, On Order, In Transit) with corresponding column configurations.

**Key observations:**
- Uses `Sheet` (side drawer) — SDD specifies a centered modal dialog instead
- `COLUMN_MAP` defines different columns per detail type — these must match the cache schema fields
- Clickable links for document numbers, vendors, customers, and item codes using pre-resolved URLs
- Fetches detail data once when opened via `useDetailData` hook
- `fetchedRef` prevents re-fetching when already fetched for current open session
- Tab auto-switches to the `triggerType` that was clicked

```tsx
import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useDetailData } from '@/hooks/useDetailData';
import type { DetailType } from '@/hooks/useDetailData';

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  locationId: string;
  triggerType: DetailType;
  resetCacheVersion?: number | null;
}

const TAB_LABELS: Record<DetailType, string> = {
  onHand: 'On Hand',
  committed: 'Committed',
  outbound: 'Outbound',
  onOrder: 'On Order',
  inTransit: 'In Transit',
};

const COLUMN_MAP: Record<DetailType, { id: string; label: string; link?: boolean }[]> = {
  onHand: [
    { id: 'docType', label: 'Doc. Type' },
    { id: 'docNum', label: 'Doc. #', link: true },
    { id: 'receiptDate', label: 'Receipt Date' },
    { id: 'vendor', label: 'Vendor', link: true },
    { id: 'lotNo', label: 'Lot #' },
    { id: 'packQty', label: 'Quantity' },
    { id: 'avgPrice', label: 'Avg Price' },
  ],
  committed: [
    { id: 'docNum', label: 'SO #', link: true },
    { id: 'customerName', label: 'Customer', link: true },
    { id: 'tranDate', label: 'Trans. Date' },
    { id: 'expectedShipDate', label: 'Expected Ship Date' },
    { id: 'itemCode', label: 'Item Code', link: true },
    { id: 'packCommitted', label: 'Pack Committed' },
    { id: 'openPackQty', label: 'Open Pack Qty' },
    { id: 'rate', label: 'Price/Pack' },
  ],
  outbound: [
    { id: 'docNum', label: 'Doc. #', link: true },
    { id: 'customerName', label: 'Customer', link: true },
    { id: 'dueDate', label: 'Ship Date' },
    { id: 'itemCode', label: 'Item Code', link: true },
    { id: 'packQty', label: 'Quantity' },
    { id: 'invoicedQty', label: 'Invoiced Qty' },
    { id: 'remainingQty', label: 'Remaining Qty' },
    { id: 'rate', label: 'Price' },
  ],
  onOrder: [
    { id: 'docNum', label: 'PO #', link: true },
    { id: 'vendorName', label: 'Vendor', link: true },
    { id: 'shipDate', label: 'Expected Delivery' },
    { id: 'itemCode', label: 'Item Code', link: true },
    { id: 'packQty', label: 'Quantity' },
    { id: 'openQty', label: 'Open Qty' },
    { id: 'rate', label: 'Price' },
  ],
  inTransit: [
    { id: 'docNum', label: 'Doc. #', link: true },
    { id: 'tranDate', label: 'Trans. Date' },
    { id: 'vendor', label: 'Vendor', link: true },
    { id: 'itemCode', label: 'Item Code', link: true },
    { id: 'packQty', label: 'Quantity' },
    { id: 'inTransitAdditional', label: 'In Transit Additional' },
    { id: 'rate', label: 'Price' },
  ],
};

export const DetailDrawer = ({
  open,
  onOpenChange,
  itemId,
  locationId,
  triggerType,
  resetCacheVersion,
}: DetailDrawerProps) => {
  const { data, loading, error, fetchDetail } = useDetailData({ resetCacheVersion });
  const [activeTab, setActiveTab] = React.useState<DetailType>(triggerType);
  const fetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (open && itemId && locationId && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchDetail(itemId, locationId).catch(() => {});
    }
    if (!open) fetchedRef.current = false;
  }, [open, itemId, locationId, fetchDetail]);

  React.useEffect(() => {
    if (open) setActiveTab(triggerType);
  }, [open, triggerType]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Inventory Detail</SheetTitle>
        </SheetHeader>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DetailType)}>
          <TabsList className="grid w-full grid-cols-5">
            {(Object.keys(TAB_LABELS) as DetailType[]).map((t) => (
              <TabsTrigger key={t} value={t} className="text-xs">
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          {(Object.keys(TAB_LABELS) as DetailType[]).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-4">
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : error ? (
                <p className="text-destructive">{error}</p>
              ) : data?.[tab]?.length ? (
                <DetailTable
                  rows={data[tab] as Record<string, unknown>[]}
                  columns={COLUMN_MAP[tab]}
                />
              ) : (
                <p className="text-muted-foreground">No data</p>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

interface DetailTableProps {
  rows: Record<string, unknown>[];
  columns: { id: string; label: string; link?: boolean }[];
}

const DetailTable = ({ rows, columns }: DetailTableProps) => (
  <Table>
    <TableHeader>
      <TableRow>
        {columns.map((col) => (
          <TableHead key={col.id}>{col.label}</TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row, i) => (
        <TableRow key={i}>
          {columns.map((col) => {
            const val = row[col.id];
            const linkUrl = col.id === 'docNum' ? row.docUrl : col.id === 'vendor' || col.id === 'vendorName' ? row.vendorUrl : col.id === 'customerName' ? row.customerUrl : col.id === 'itemCode' ? row.itemUrl : undefined;
            return (
              <TableCell key={col.id}>
                {col.link && linkUrl ? (
                  <a
                    href={String(linkUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {String(val ?? '')}
                  </a>
                ) : (
                  String(val ?? '')
                )}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
```

---

## 5. CreateOrderModal.tsx

**Path:** `react-app/src/components/CreateOrderModal.tsx`

Dialog modal for creating Purchase Orders or Sales Orders directly from the trader screen.

**Key observations:**
- Party ID (vendor/customer) is a raw text input requiring the NetSuite internal ID — SDD specifies a searchable entity lookup
- Quantity input is a simple number field — no UOM indicator or conversion
- Date field is a standard HTML date input
- Notes field is optional
- Posts to `apiRequest('createOrder', ...)` which calls the RESTlet POST endpoint
- Success state shows a link to the created document
- No validation beyond HTML `required` attributes
- No pre-population from selected row data (prefill prop exists but is rarely passed)

```tsx
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';

type OrderType = 'PO' | 'SO';

interface CreateOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: OrderType;
  itemId: string;
  locationId: string;
  prefill?: {
    partyId?: string;
    quantity?: number;
  };
  onSuccess?: (result: { docId: number; docNum: string; docUrl: string }) => void;
}

export const CreateOrderModal = ({
  open,
  onOpenChange,
  type,
  itemId,
  locationId,
  prefill = {},
  onSuccess,
}: CreateOrderModalProps) => {
  const [partyId, setPartyId] = React.useState(prefill.partyId || '');
  const [quantity, setQuantity] = React.useState(String(prefill.quantity || 1));
  const [date, setDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ docId: number; docNum: string; docUrl: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setPartyId(prefill.partyId || '');
      setQuantity(String(prefill.quantity ?? 1));
      setDate('');
      setNotes('');
      setError(null);
      setResult(null);
    }
  }, [open, prefill.partyId, prefill.quantity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ docId: number; docNum: string; docUrl: string }>('createOrder', {
        type,
        itemId,
        locationId,
        partyId: partyId.trim(),
        quantity: parseFloat(quantity) || 1,
        date: date || new Date().toISOString().slice(0, 10),
        notes: notes.trim() || undefined,
      });
      setResult(res);
      onSuccess?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create order');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Create {type === 'PO' ? 'Purchase Order' : 'Sales Order'}
          </DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <p className="text-green-600 dark:text-green-400">
              {type} created successfully.
            </p>
            <a
              href={result.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-mono"
            >
              {result.docNum}
            </a>
            <Button onClick={handleClose}>Close</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="party" className="text-sm font-medium block mb-1">
                {type === 'PO' ? 'Vendor ID' : 'Customer ID'} (internal ID)
              </label>
              <Input
                id="party"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                placeholder={type === 'PO' ? 'Vendor internal ID' : 'Customer internal ID'}
                required
              />
            </div>
            <div>
              <label htmlFor="quantity" className="text-sm font-medium block mb-1">Quantity (Packs)</label>
              <Input
                id="quantity"
                type="number"
                min={0.01}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="date" className="text-sm font-medium block mb-1">
                {type === 'PO' ? 'Expected Delivery' : 'Expected Ship'} Date
              </label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="notes" className="text-sm font-medium block mb-1">Notes</label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>
            {error && (
              <p className="text-destructive text-sm">{error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating…' : 'Create'}
              </Button>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
```

---

## 6. OrderPopover.tsx

**Path:** `react-app/src/components/OrderPopover.tsx`

Small popover triggered by the `$` button in the order column. Offers a choice between creating a Purchase Order or Sales Order, then opens the `CreateOrderModal`.

**Key observations:**
- Uses Radix Popover for the PO/SO selection
- Closes the popover before opening the modal (prevents z-index conflicts)
- Passes `row.internalId` and `row.locationId` to the modal
- No prefill data is passed (no quantity, no party)

```tsx
import * as React from 'react';
import { DollarSign } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CreateOrderModal } from '@/components/CreateOrderModal';
import type { SummaryRow } from '@/lib/api';

type OrderType = 'PO' | 'SO';

interface OrderPopoverProps {
  row: SummaryRow;
}

export const OrderPopover = ({ row }: OrderPopoverProps) => {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [modalType, setModalType] = React.useState<OrderType | null>(null);

  const handleSelect = (type: OrderType) => {
    setPopoverOpen(false);
    setModalType(type);
  };

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="text-gold hover:text-gold/80 transition-colors"
            aria-label="Create order"
          >
            <DollarSign className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 p-2 space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => handleSelect('PO')}
          >
            Purchase Order
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => handleSelect('SO')}
          >
            Sales Order
          </Button>
        </PopoverContent>
      </Popover>

      {modalType && (
        <CreateOrderModal
          open
          onOpenChange={(open) => { if (!open) setModalType(null); }}
          type={modalType}
          itemId={row.internalId}
          locationId={row.locationId}
        />
      )}
    </>
  );
};
```

---

## 7. MultiSelectCombobox.tsx

**Path:** `react-app/src/components/MultiSelectCombobox.tsx`

Reusable multi-select dropdown with search, badge display, and clear functionality. Used by the FilterPanel for every filter field.

**Key observations:**
- Uses Radix `Command` (cmdk) for searchable list with keyboard navigation
- Shows selected count when >1 item selected ("N selected")
- Badge pills at bottom of dropdown for up to 3 selected items, then "+N" overflow
- Clear (X) button on the trigger to reset selection
- Popover width matches trigger width via CSS variable
- Client-side filtering of options by search string

```tsx
import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn(
            'min-w-[160px] justify-between font-normal',
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
              <X
                className="h-4 w-4 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
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
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selected.includes(option.value) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {option.label}
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
```

---

## 8. ThemeToggle.tsx

**Path:** `react-app/src/components/ThemeToggle.tsx`

Simple light/dark/system theme toggle using a dropdown menu. Currently NOT rendered anywhere in the app layout (the header doesn't include it).

```tsx
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/context/ThemeProvider';

export const ThemeToggle = () => {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
```

---

## Cross-Reference: Component Gaps vs SDD

This section summarizes the key deviations visible in these component files relative to the SDD requirements (see Part 2 for the full gap analysis):

| Component | Gap | SDD Requirement | Current State |
|---|---|---|---|
| `App.tsx` | CWP pills non-functional | Should filter data by subsidiary view | Only changes UoM dropdown options |
| `App.tsx` | UoM selector non-functional | Should convert all quantity displays | State stored but never applied |
| `App.tsx` | ThemeToggle not rendered | Should be in header | Component exists, not placed |
| `FilterPanel.tsx` | Starts expanded | SDD: collapsed by default | `filtersOpen = true` |
| `InventoryTable.tsx` | Column order wrong | SDD: qty columns before attributes | Attributes before qty columns |
| `InventoryTable.tsx` | No row virtualization | SDD: required for 2000+ rows | TanStack Virtual imported but unused |
| `InventoryTable.tsx` | Available column formula | SDD: OnHand - Committed - Outbound + OnOrder + InTransit | Computed server-side, verify formula |
| `DetailDrawer.tsx` | Uses side drawer | SDD: centered modal dialog | Sheet component instead of Dialog |
| `CreateOrderModal.tsx` | Raw text party ID | SDD: searchable entity lookup | Plain text input for internal ID |
| `CreateOrderModal.tsx` | No quantity UoM | SDD: show current UoM in field | Just "Packs" label |

---

*End of Part 6. This completes the multi-part context package (Parts 1–6).*

## Recommended Paste Order for Claude Web

1. **Part 3** — Paste the full SDD document (`MGSL_TraderScreen_React_Requirements_v1.3.md`) first as the authoritative reference
2. **Part 1** — Project Overview & Architecture
3. **Part 2** — Gap Analysis & Implementation Status (includes meeting context)
4. **Part 4** — Backend SuiteScript Code
5. **Part 5** — Frontend Core Code (types, hooks, config, API, context, CSS)
6. **Part 6** — Frontend Components Code (this file)
