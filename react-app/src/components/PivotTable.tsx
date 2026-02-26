import * as React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnDef,
  type ExpandedState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { OrderPopover } from '@/components/OrderPopover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { PivotRow } from '@/lib/pivotTransform';

interface PivotTableProps {
  data: PivotRow[];
  totals: {
    onHand: number;
    committed: number;
    outbound: number;
    onOrder?: number;
    inTransit: number;
    available: number;
  };
  onDrillDown?: (type: string, row: PivotRow) => void;
}

const AttrCell = ({ value }: { value?: string }) => (
  <span className="text-sm hover:bg-attr-hover hover:underline cursor-default rounded px-1">
    {value || '—'}
  </span>
);

export const PivotTable = ({ data, totals, onDrillDown }: PivotTableProps) => {
  const [expanded, setExpanded] = React.useState<ExpandedState>({});

  const columns = React.useMemo<ColumnDef<PivotRow>[]>(
    () => [
      {
        id: 'expander',
        header: () => null,
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <button
              type="button"
              onClick={row.getToggleExpandedHandler()}
              className="p-1 hover:bg-muted rounded"
            >
              {row.getIsExpanded() ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="w-6 inline-block" />
          ),
        size: 40,
      },
      {
        id: 'order',
        header: () => '$',
        cell: ({ row }) =>
          !row.original.isGroupRow && row.original.internalId && row.original.locationId ? (
            <OrderPopover row={row.original} />
          ) : (
            <span className="w-8 inline-block" />
          ),
        size: 40,
      },
      {
        accessorKey: 'itemCode',
        header: 'Item Code',
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          const url = row.original.itemUrl;
          if (url && v) {
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-mono text-sm">
                {v}
              </a>
            );
          }
          return <span className="font-mono text-sm">{v || '—'}</span>;
        },
        size: 120,
      },
      {
        accessorKey: 'locationName',
        header: 'Location',
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          const url = row.original.locationUrl;
          if (url && v) {
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {v}
              </a>
            );
          }
          return <span>{v || '—'}</span>;
        },
        size: 100,
      },
      {
        accessorKey: 'itemName',
        header: 'Item Name',
        cell: ({ getValue }) => <span className="text-sm">{(getValue() as string) || '—'}</span>,
        size: 180,
      },
      {
        accessorKey: 'species',
        header: 'Species',
        cell: ({ getValue }) => <AttrCell value={getValue() as string} />,
        size: 70,
      },
      {
        accessorKey: 'thickness',
        header: 'Thickness',
        cell: ({ getValue }) => <AttrCell value={getValue() as string} />,
        size: 70,
      },
      {
        accessorKey: 'width',
        header: 'Width',
        cell: ({ row, getValue }) =>
          row.original.isGroupRow ? (
            <span className="font-semibold font-mono">{(getValue() as string) || '—'}</span>
          ) : (
            <span className="pl-6 font-mono">{(getValue() as string) || '—'}</span>
          ),
        size: 70,
      },
      {
        accessorKey: 'length',
        header: 'Length',
        cell: ({ getValue }) => <span className="font-mono">{(getValue() as string) || '—'}</span>,
        size: 70,
      },
      {
        accessorKey: 'grade',
        header: 'Grade',
        cell: ({ getValue }) => <AttrCell value={getValue() as string} />,
        size: 70,
      },
      {
        accessorKey: 'finition',
        header: 'Finition',
        cell: ({ getValue }) => <AttrCell value={getValue() as string} />,
        size: 70,
      },
      {
        accessorKey: 'humidity',
        header: 'Humidity',
        cell: ({ getValue }) => <AttrCell value={getValue() as string} />,
        size: 70,
      },
      {
        accessorKey: 'plannage',
        header: 'Plannage',
        cell: ({ getValue }) => <AttrCell value={getValue() as string} />,
        size: 70,
      },
      {
        accessorKey: 'etampage',
        header: 'Étampage',
        cell: ({ getValue }) => <AttrCell value={getValue() as string} />,
        size: 70,
      },
      {
        accessorKey: 'autres',
        header: 'Autres',
        cell: ({ getValue }) => <AttrCell value={getValue() as string} />,
        size: 70,
      },
      {
        accessorKey: 'onHand',
        header: 'On Hand',
        cell: ({ getValue, row }) => (
          <MetricCell
            value={getValue() as number}
            row={row.original}
            type="onHand"
            onDrillDown={onDrillDown}
          />
        ),
      },
      {
        accessorKey: 'committed',
        header: 'Committed',
        cell: ({ getValue, row }) => (
          <MetricCell
            value={getValue() as number}
            row={row.original}
            type="committed"
            onDrillDown={onDrillDown}
          />
        ),
      },
      {
        accessorKey: 'outbound',
        header: 'Outbound',
        cell: ({ getValue, row }) => (
          <MetricCell
            value={getValue() as number}
            row={row.original}
            type="outbound"
            onDrillDown={onDrillDown}
          />
        ),
      },
      {
        accessorKey: 'onOrder',
        header: 'On Order',
        cell: ({ getValue, row }) => (
          <MetricCell
            value={(getValue() as number) ?? (row.original.onOrder ?? 0)}
            row={row.original}
            type="onOrder"
            onDrillDown={onDrillDown}
          />
        ),
      },
      {
        accessorKey: 'inTransit',
        header: 'In Transit',
        cell: ({ getValue, row }) => (
          <MetricCell
            value={getValue() as number}
            row={row.original}
            type="inTransit"
            onDrillDown={onDrillDown}
          />
        ),
      },
      {
        accessorKey: 'available',
        header: 'Available',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-green-600 dark:text-green-400">{formatNum(getValue() as number)}</span>
        ),
      },
      {
        accessorKey: 'averageCost',
        header: 'Avg Price',
        cell: ({ getValue }) => (
          <span className="tabular-nums font-mono text-gold">{formatNum(getValue() as number)}</span>
        ),
        size: 90,
      },
    ],
    [onDrillDown]
  );

  const table = useReactTable({
    data,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getSubRows: (row) => row.subRows,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  return (
    <div className="rounded-md border overflow-auto max-h-[calc(100vh-320px)]">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="sticky top-0 bg-muted/95 z-10">
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="whitespace-nowrap">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(
                row.original.isGroupRow && 'bg-muted/50 font-medium'
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="sticky bottom-0 bg-muted font-bold">
            <TableCell colSpan={15}>TOTALS</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.onHand)}</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.committed)}</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.outbound)}</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.onOrder ?? 0)}</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.inTransit)}</TableCell>
            <TableCell className="tabular-nums text-green-600 dark:text-green-400">{formatNum(totals.available)}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
};

const formatNum = (n: number) =>
  Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2);

interface MetricCellProps {
  value: number;
  row: PivotRow;
  type: string;
  onDrillDown?: (type: string, row: PivotRow) => void;
}

const MetricCell = ({ value, row, type, onDrillDown }: MetricCellProps) => {
  const canDrill = onDrillDown && row.internalId && row.locationId && !row.isGroupRow;
  const formatted = formatNum(value);

  if (canDrill && value !== 0) {
    return (
      <button
        type="button"
        onClick={() => onDrillDown(type, row)}
        className="text-primary hover:underline font-medium tabular-nums"
      >
        [{formatted}]
      </button>
    );
  }
  return <span className="tabular-nums">{formatted}</span>;
};
