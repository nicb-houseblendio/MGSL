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

interface InventoryTableMTLProps {
  data: SummaryRow[];
  onDrillDown?: (type: DetailType, row: SummaryRow) => void;
  onCellFilter?: (filterKey: string, value: string) => void;
  activeFilters?: Record<string, string[]>;
  onRowSelectionChange?: (selection: Record<string, boolean>) => void; // reserved for V2
  resetKey?: number;
  totals?: {
    onHand: number;
    committed: number;
    outbound: number;
    onOrder: number;
    inTransit: number;
    available: number;
  };
  rowCount?: number;
  uom?: string;
}

// ── Formatters ──────────────────────────────────────────────────────────────

const INT_UOMS_MTL = new Set(['Packs']);

const formatQtyMTL = (n: number, uom?: string): string => {
  if (n === 0) return '0';
  if (!uom || INT_UOMS_MTL.has(uom)) {
    return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

const formatMBF = (n?: number): string => {
  if (n == null || n === 0) return '0.00';
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const convertQtyMTL = (value: number, uom: string, mbfFactor?: number): number => {
  if (uom !== 'MBF') return value;
  const f = mbfFactor ?? 0;
  if (f === 0) return 0;
  return Math.round(value * f * 100) / 100;
};

// ── CurrencyBadge — exported for reuse in PriceListModal ────────────────────

export const CurrencyBadge = ({ currency }: { currency?: string }) => {
  if (!currency) return null;
  const isUSD = currency === 'USD';
  return (
    <span
      style={{
        background: isUSD ? '#EAF3DE' : '#E8F4FD',
        color: isUSD ? '#27500A' : '#0D47A1',
        border: isUSD ? '1px solid #A5D6A7' : '1px solid #90CAF9',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.04em',
        display: 'inline-block',
      }}
    >
      {currency}
    </span>
  );
};

// ── MetricCellMTL ────────────────────────────────────────────────────────────

interface MetricCellMTLProps {
  value: number;
  type: DetailType;
  row: SummaryRow;
  onDrillDown?: (type: DetailType, row: SummaryRow) => void;
  uom?: string;
}

const METRIC_COLOR_CLASS: Record<string, string> = {
  onHand:    'text-metric-onhand',
  committed: 'text-metric-committed',
  outbound:  'text-metric-outbound',
  onOrder:   'text-metric-onorder',
  inTransit: 'text-metric-intransit',
  available: 'text-metric-onhand',
};

const MetricCellMTL = ({ value, type, row, onDrillDown, uom }: MetricCellMTLProps) => {
  if (uom === 'MBF' && (row.mbfFactor ?? 0) === 0) {
    return <span className="text-[#7A8FA3] tabular-nums text-right block">N/A</span>;
  }
  const displayValue = convertQtyMTL(value, uom ?? 'Packs', row.mbfFactor);
  const isAvail = type === 'available';
  const prefix = isAvail && displayValue >= 0 ? '+' : '';
  const content = `${prefix}${formatQtyMTL(displayValue, uom)}`;
  const colorClass = METRIC_COLOR_CLASS[type] ?? 'text-metric-onhand';
  const canDrill = onDrillDown && row.internalId && row.locationId;

  if (canDrill && value !== 0) {
    return (
      <button
        type="button"
        onClick={() => onDrillDown(type, row)}
        className={`${colorClass} hover:underline font-medium tabular-nums text-right w-full block`}
      >
        {content}
      </button>
    );
  }
  return <span className={`${colorClass} tabular-nums text-right block`}>{content}</span>;
};

// ── SortHeader ───────────────────────────────────────────────────────────────

const SortHeaderMTL = ({
  label,
  column,
  align,
}: {
  label: string;
  align?: 'left' | 'right';
  column: {
    getIsSorted: () => false | 'asc' | 'desc';
    getToggleSortingHandler: () => ((event: unknown) => void) | undefined;
  };
}) => {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className={`flex items-center gap-1 hover:text-white/90 select-none ${align === 'right' ? 'ml-auto' : ''}`}
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

// ── Footer constants ─────────────────────────────────────────────────────────

const METRIC_COLUMNS_MTL = new Set([
  'onHandMBF', 'onHand', 'committed', 'outbound', 'onOrder', 'inTransit', 'available',
]);

const FOOTER_LABEL_MTL: Record<string, string> = {
  onHandMBF:    '#A5D6A7',
  onHand:       '#A5D6A7',
  committed:    '#FFB74D',
  outbound:     '#F48FB1',
  onOrder:      '#90CAF9',
  inTransit:    '#CE93D8',
  available:    '#A5D6A7',
  availableNeg: '#FCA5A5',
};

// ── InventoryTableMTL ────────────────────────────────────────────────────────

export const InventoryTableMTL = ({
  data,
  onDrillDown,
  onCellFilter,
  activeFilters,
  resetKey,
  totals,
  rowCount,
  uom,
}: InventoryTableMTLProps) => {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const onHandMBFTotal = React.useMemo(
    () => data.reduce((sum, r) => sum + (r.quantityFBM ?? 0), 0),
    [data]
  );

  React.useEffect(() => {
    if (resetKey != null && resetKey > 0) {
      setSorting([]);
    }
  }, [resetKey]);

  const columns = React.useMemo<ColumnDef<SummaryRow>[]>(
    () => [
      // Location
      {
        accessorKey: 'locationName',
        id: 'location',
        header: ({ column }) => <SortHeaderMTL label="LOCATION" column={column} />,
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs">—</span>;
          const locId = row.original.locationId;
          const active = activeFilters?.location?.includes(locId);
          return (
            <button
              type="button"
              onClick={() => onCellFilter?.('location', locId)}
              className={`w-full block text-xs hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}
            >
              {v}
            </button>
          );
        },
        size: 130,
      },
      // Item ID
      {
        accessorKey: 'itemCode',
        header: ({ column }) => <SortHeaderMTL label="ITEM ID" column={column} />,
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="font-mono text-xs">—</span>;
          const id = row.original.internalId;
          const active = activeFilters?.item?.includes(id);
          return (
            <div onClick={() => onCellFilter?.('item', id)} className={`w-full cursor-pointer ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}>
              <span className="font-mono text-xs">{v}</span>
            </div>
          );
        },
        size: 130,
      },
      // Item Description
      {
        accessorKey: 'itemName',
        id: 'itemDescription',
        header: ({ column }) => <SortHeaderMTL label="ITEM DESCRIPTION" column={column} />,
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs">—</span>;
          const itemId = row.original.internalId;
          const active = activeFilters?.item?.includes(itemId);
          return (
            <button
              type="button"
              onClick={() => onCellFilter?.('item', itemId)}
              title={v}
              className={`w-full block text-xs hover:underline cursor-pointer text-left truncate ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}
            >
              {v}
            </button>
          );
        },
        size: 160,
      },
      // Thickness
      {
        accessorKey: 'thickness',
        header: ({ column }) => <SortHeaderMTL label="THICKNESS" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs font-mono">—</span>;
          const active = activeFilters?.thickness?.includes(v);
          return (
            <button
              type="button"
              onClick={() => onCellFilter?.('thickness', v)}
              className={`w-full block text-xs font-mono hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}
            >
              {v}
            </button>
          );
        },
        size: 90,
      },
      // Width
      {
        accessorKey: 'width',
        header: ({ column }) => <SortHeaderMTL label="WIDTH" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs font-mono">—</span>;
          const active = activeFilters?.width?.includes(v);
          return (
            <button
              type="button"
              onClick={() => onCellFilter?.('width', v)}
              className={`w-full block text-xs font-mono hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}
            >
              {v}
            </button>
          );
        },
        size: 80,
      },
      // Length
      {
        accessorKey: 'length',
        header: ({ column }) => <SortHeaderMTL label="LENGTH" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs font-mono">—</span>;
          const active = activeFilters?.length?.includes(v);
          return (
            <button
              type="button"
              onClick={() => onCellFilter?.('length', v)}
              className={`w-full block text-xs font-mono hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}
            >
              {v}
            </button>
          );
        },
        size: 80,
      },
      // Grade
      {
        accessorKey: 'grade',
        header: ({ column }) => <SortHeaderMTL label="GRADE" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs">—</span>;
          const active = activeFilters?.grade?.includes(v);
          return (
            <button
              type="button"
              onClick={() => onCellFilter?.('grade', v)}
              className={`w-full block text-xs hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}
            >
              {v}
            </button>
          );
        },
        size: 90,
      },
      // On Hand (MBF) — visible only in Packs mode as a supplementary reference column
      ...(uom === 'Packs'
        ? [
            {
              id: 'onHandMBF',
              accessorFn: (row: SummaryRow) => row.quantityFBM ?? 0,
              header: ({ column }: { column: Parameters<typeof SortHeaderMTL>[0]['column'] }) => (
                <SortHeaderMTL label="ON HAND (MBF)" column={column} align="right" />
              ),
              cell: ({ row }: { row: { original: SummaryRow } }) => (
                <span className="text-metric-onhand tabular-nums text-right block">
                  {formatMBF(row.original.quantityFBM)}
                </span>
              ),
              sortingFn: (
                rowA: { original: SummaryRow },
                rowB: { original: SummaryRow }
              ) => (rowA.original.quantityFBM ?? 0) - (rowB.original.quantityFBM ?? 0),
              size: 115,
            } as ColumnDef<SummaryRow>,
          ]
        : []),
      // On Hand
      {
        accessorKey: 'onHand',
        header: ({ column }) => (
          <SortHeaderMTL
            label={uom === 'Packs' ? 'ON HAND (Packs)' : 'ON HAND'}
            column={column}
            align="right"
          />
        ),
        cell: ({ getValue, row }) => (
          <MetricCellMTL
            value={getValue() as number}
            type="onHand"
            row={row.original}
            onDrillDown={onDrillDown}
            uom={uom}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQtyMTL(rowA.original.onHand, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQtyMTL(rowB.original.onHand, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: uom === 'Packs' ? 120 : 85,
      },
      // Committed
      {
        accessorKey: 'committed',
        header: ({ column }) => <SortHeaderMTL label="COMMITTED" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCellMTL
            value={getValue() as number}
            type="committed"
            row={row.original}
            onDrillDown={onDrillDown}
            uom={uom}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQtyMTL(rowA.original.committed, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQtyMTL(rowB.original.committed, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 90,
      },
      // Outbound
      {
        accessorKey: 'outbound',
        header: ({ column }) => <SortHeaderMTL label="OUTBOUND" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCellMTL
            value={getValue() as number}
            type="outbound"
            row={row.original}
            onDrillDown={onDrillDown}
            uom={uom}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQtyMTL(rowA.original.outbound, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQtyMTL(rowB.original.outbound, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 85,
      },
      // On Order
      {
        accessorKey: 'onOrder',
        header: ({ column }) => <SortHeaderMTL label="ON ORDER" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCellMTL
            value={(getValue() as number) ?? 0}
            type="onOrder"
            row={row.original}
            onDrillDown={onDrillDown}
            uom={uom}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQtyMTL(rowA.original.onOrder, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQtyMTL(rowB.original.onOrder, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 85,
      },
      // In Transit
      {
        accessorKey: 'inTransit',
        header: ({ column }) => <SortHeaderMTL label="IN TRANSIT" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCellMTL
            value={getValue() as number}
            type="inTransit"
            row={row.original}
            onDrillDown={onDrillDown}
            uom={uom}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQtyMTL(rowA.original.inTransit, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQtyMTL(rowB.original.inTransit, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 90,
      },
      // Available — clickable in MTL (unlike IND which is display-only)
      {
        accessorKey: 'available',
        header: ({ column }) => <SortHeaderMTL label="AVAILABLE" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCellMTL
            value={getValue() as number}
            type="available"
            row={row.original}
            onDrillDown={onDrillDown}
            uom={uom}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQtyMTL(rowA.original.available, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQtyMTL(rowB.original.available, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 90,
      },
    ],
    [uom, onDrillDown, onCellFilter, activeFilters]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.detailKey || `${row.internalId}-${row.locationId}`,
  });

  return (
    <div className="rounded-md border border-navy-mid/30 overflow-auto flex-1 min-h-0 bg-surface inventory-table-scroll">
      <Table
        className="w-full"
        style={{ minWidth: table.getTotalSize(), borderCollapse: 'collapse', tableLayout: 'fixed' }}
      >
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
                  className="whitespace-nowrap font-bold uppercase tracking-wider text-white/80"
                  style={{ width: header.getSize(), padding: '8px 10px', fontSize: '11px', height: 'auto' }}
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
                  <TableCell
                    key={cell.id}
                    className="py-1.5 px-3"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                No data available
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {totals &&
          (() => {
            const headers = table.getHeaderGroups()[0].headers;
            let leadingNonMetric = 0;
            for (const h of headers) {
              if (METRIC_COLUMNS_MTL.has(h.column.id)) break;
              leadingNonMetric++;
            }
            return (
              <tfoot>
                <TableRow
                  className="sticky z-10 text-white !border-b-0"
                  style={{
                    bottom: -1,
                    background: 'linear-gradient(to right, var(--navy), var(--navy-mid))',
                    boxShadow: 'inset 0 2px 0 rgba(200,160,53,0.6)',
                  }}
                >
                  {leadingNonMetric > 0 && (
                    <TableCell colSpan={leadingNonMetric} className="pt-[13px] pb-2.5 px-3">
                      <span className="text-[12px] font-semibold uppercase tracking-wider text-white/70 whitespace-nowrap">
                        TOTALS · {rowCount ?? 0} items
                      </span>
                    </TableCell>
                  )}
                  {headers.slice(leadingNonMetric).map((header) => {
                    const colId = header.column.id;
                    if (METRIC_COLUMNS_MTL.has(colId)) {
                      const isOnHandMBF = colId === 'onHandMBF';
                      const val = isOnHandMBF
                        ? onHandMBFTotal
                        : (totals[colId as keyof typeof totals] ?? 0);
                      const isAvailable = colId === 'available';
                      const color = isAvailable
                        ? val >= 0
                          ? FOOTER_LABEL_MTL.available
                          : FOOTER_LABEL_MTL.availableNeg
                        : (FOOTER_LABEL_MTL[colId] ?? '#fff');
                      const display = isOnHandMBF
                        ? formatMBF(val)
                        : isAvailable
                          ? `${val >= 0 ? '' : '▼'}${formatQtyMTL(Math.abs(val), uom)}`
                          : formatQtyMTL(val, uom);
                      return (
                        <TableCell
                          key={colId}
                          className="pt-[13px] pb-2.5 px-3"
                          style={{ width: header.getSize() }}
                        >
                          <span
                            className="font-mono text-[12px] font-bold tabular-nums text-right block"
                            style={{ color }}
                          >
                            {display}
                          </span>
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell
                        key={colId}
                        className="pt-[13px] pb-2.5 px-3"
                        style={{ width: header.getSize() }}
                      />
                    );
                  })}
                </TableRow>
              </tfoot>
            );
          })()}
      </Table>
    </div>
  );
};
