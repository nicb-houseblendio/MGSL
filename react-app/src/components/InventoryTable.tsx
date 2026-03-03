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
