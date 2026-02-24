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
    inTransit: number;
    available: number;
  };
  onDrillDown?: (type: string, row: PivotRow) => void;
}

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
        accessorKey: 'width',
        header: 'Width',
        cell: ({ row, getValue }) =>
          row.original.isGroupRow ? (
            <span className="font-semibold">{getValue() as string}</span>
          ) : (
            <span className="pl-6">{getValue() as string}</span>
          ),
      },
      {
        accessorKey: 'length',
        header: 'Length',
        cell: ({ getValue }) => getValue() as string || '-',
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
          <span className="tabular-nums">{formatNum(getValue() as number)}</span>
        ),
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
            <TableCell colSpan={3}>TOTALS</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.onHand)}</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.committed)}</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.outbound)}</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.inTransit)}</TableCell>
            <TableCell className="tabular-nums">{formatNum(totals.available)}</TableCell>
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
