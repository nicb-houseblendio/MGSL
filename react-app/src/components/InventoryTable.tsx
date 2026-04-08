import * as React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnOrderState,
  type Header,
} from '@tanstack/react-table';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
  onCellFilter?: (filterKey: string, value: string) => void;
  activeFilters?: Record<string, string[]>;
  onRowSelectionChange?: (selection: Record<string, boolean>) => void;
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

const INT_UOMS = new Set(['Packs', 'TL']);
const formatQty = (n: number, uom?: string): string => {
  if (n === 0) return '0';
  if (!uom || INT_UOMS.has(uom)) {
    const rounded = Math.round(n);
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

const formatCurrency = (n: number) =>
  n === 0 ? '$0.00' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const convertQty = (value: number, uom: string, mbfFactor?: number): number => {
  if (uom !== 'MBF') return value;
  const f = mbfFactor ?? 0;
  if (f === 0) return 0;
  return Math.round(value * f * 100) / 100;
};


interface MetricCellProps {
  value: number;
  row: SummaryRow;
  type: DetailType;
  colorClass: string;
  prefix?: string;
  onDrillDown?: (type: DetailType, row: SummaryRow) => void;
  uom?: string;
  mbfFactor?: number;
}

const MetricCell = ({ value, row, type, colorClass, prefix, onDrillDown, uom, mbfFactor }: MetricCellProps) => {
  if (uom === 'MBF' && (mbfFactor ?? 0) === 0) {
    return <span className="text-[#7A8FA3] tabular-nums text-right block">N/A</span>;
  }
  const canDrill = onDrillDown && row.internalId && row.locationId;
  const display = `${prefix || ''}${formatQty(value, uom)}`;

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

const SortHeader = ({ label, column, align }: { label: string; align?: 'left' | 'right'; column: { getIsSorted: () => false | 'asc' | 'desc'; getToggleSortingHandler: () => ((event: unknown) => void) | undefined } }) => {
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

/* Draggable header cell for column reorder */
const DraggableHeader = ({ header }: { header: Header<SummaryRow, unknown> }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: header.column.id,
  });

  const style: React.CSSProperties = {
    width: header.getSize(),
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    position: 'relative',
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <TableHead
      ref={setNodeRef}
      className="whitespace-nowrap font-bold uppercase tracking-wider text-white/80"
      style={{ ...style, padding: '8px 10px', fontSize: '11px', height: 'auto' }}
      {...attributes}
      {...listeners}
    >
      {header.isPlaceholder
        ? null
        : flexRender(header.column.columnDef.header, header.getContext())}
    </TableHead>
  );
};

export const InventoryTable = ({ data, onDrillDown, onCellFilter, activeFilters, onRowSelectionChange, resetKey, totals, rowCount, uom }: InventoryTableProps) => {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([]);

  const onHandMbfTotal = React.useMemo(
    () => uom === 'Packs' ? data.reduce((sum, r) => sum + (r.quantityFBM ?? 0), 0) : 0,
    [data, uom]
  );

  React.useEffect(() => {
    onRowSelectionChange?.(rowSelection);
  }, [rowSelection, onRowSelectionChange]);

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
        accessorKey: 'locationName',
        header: ({ column }) => <SortHeader label="LOCATION" column={column} />,
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs">—</span>;
          const locId = row.original.locationId;
          const active = activeFilters?.location?.includes(locId);
          return <button type="button" onClick={() => onCellFilter?.('location', locId)} className={`w-full block text-xs hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}>{v}</button>;
        },
        size: 120,
      },
      {
        accessorKey: 'itemCode',
        header: ({ column }) => <SortHeader label="ITEM ID" column={column} />,
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="font-mono text-xs">—</span>;
          const id = row.original.internalId;
          const itemUrl = row.original.itemUrl;
          const active = activeFilters?.item?.includes(id);
          return (
            <div onClick={() => onCellFilter?.('item', id)} className={`w-full cursor-pointer ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}>
              {itemUrl ? (
                <a href={itemUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-xs hover:underline">{v}</a>
              ) : (
                <span className="font-mono text-xs">{v}</span>
              )}
            </div>
          );
        },
        size: 130,
      },
      {
        accessorKey: 'itemName',
        header: ({ column }) => <SortHeader label="ITEM" column={column} />,
        cell: ({ row, getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs">—</span>;
          const id = row.original.internalId;
          const active = activeFilters?.item?.includes(id);
          return <button type="button" onClick={() => onCellFilter?.('item', id)} className={`w-full block text-xs hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}>{v}</button>;
        },
        size: 220,
      },
      {
        accessorKey: 'thickness',
        header: ({ column }) => <SortHeader label="THICKNESS" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs font-mono">—</span>;
          const active = activeFilters?.thickness?.includes(v);
          return <button type="button" onClick={() => onCellFilter?.('thickness', v)} className={`w-full block text-xs font-mono hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}>{v}</button>;
        },
        size: 90,
      },
      {
        accessorKey: 'width',
        header: ({ column }) => <SortHeader label="WIDTH" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs font-mono">—</span>;
          const active = activeFilters?.width?.includes(v);
          return <button type="button" onClick={() => onCellFilter?.('width', v)} className={`w-full block text-xs font-mono hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}>{v}</button>;
        },
        size: 90,
      },
      {
        accessorKey: 'length',
        header: ({ column }) => <SortHeader label="LENGTH" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs font-mono">—</span>;
          const active = activeFilters?.length?.includes(v);
          return <button type="button" onClick={() => onCellFilter?.('length', v)} className={`w-full block text-xs font-mono hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}>{v}</button>;
        },
        size: 90,
      },
      {
        accessorKey: 'grade',
        header: ({ column }) => <SortHeader label="GRADE" column={column} />,
        cell: ({ getValue }) => {
          const v = getValue() as string;
          if (!v) return <span className="text-xs">—</span>;
          const active = activeFilters?.grade?.includes(v);
          return <button type="button" onClick={() => onCellFilter?.('grade', v)} className={`w-full block text-xs hover:underline cursor-pointer text-left ${active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''}`}>{v}</button>;
        },
        size: 90,
      },
      ...(uom === 'Packs' ? [{
        accessorKey: 'quantityFBM',
        header: ({ column }: { column: Parameters<typeof SortHeader>[0]['column'] }) => <SortHeader label="ON HAND (MBF)" column={column} align="right" />,
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const val = (getValue() as number) ?? 0;
          return (
            <span className="text-metric-onhand tabular-nums text-right block">
              {(Math.round(val * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          );
        },
        sortingFn: (rowA: { original: SummaryRow }, rowB: { original: SummaryRow }) => (rowA.original.quantityFBM ?? 0) - (rowB.original.quantityFBM ?? 0),
        size: 115,
      } as ColumnDef<SummaryRow>] : []),
      {
        accessorKey: 'onHand',
        header: ({ column }) => <SortHeader label={uom === 'Packs' ? 'ON HAND (Packs)' : 'ON HAND'} column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={convertQty(getValue() as number, uom ?? 'Packs', row.original.mbfFactor)}
            row={row.original}
            type="onHand"
            colorClass="text-metric-onhand"
            onDrillDown={onDrillDown}
            uom={uom}
            mbfFactor={row.original.mbfFactor}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQty(rowA.original.onHand, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQty(rowB.original.onHand, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: uom === 'Packs' ? 115 : 85,
      },
      {
        accessorKey: 'committed',
        header: ({ column }) => <SortHeader label="COMMITTED" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={convertQty(getValue() as number, uom ?? 'Packs', row.original.mbfFactor)}
            row={row.original}
            type="committed"
            colorClass="text-metric-committed"
            onDrillDown={onDrillDown}
            uom={uom}
            mbfFactor={row.original.mbfFactor}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQty(rowA.original.committed, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQty(rowB.original.committed, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 85,
      },
      {
        accessorKey: 'outbound',
        header: ({ column }) => <SortHeader label="OUTBOUND" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={convertQty(getValue() as number, uom ?? 'Packs', row.original.mbfFactor)}
            row={row.original}
            type="outbound"
            colorClass="text-metric-outbound"
            onDrillDown={onDrillDown}
            uom={uom}
            mbfFactor={row.original.mbfFactor}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQty(rowA.original.outbound, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQty(rowB.original.outbound, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 85,
      },
      {
        accessorKey: 'onOrder',
        header: ({ column }) => <SortHeader label="ON ORDER" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={convertQty((getValue() as number) ?? 0, uom ?? 'Packs', row.original.mbfFactor)}
            row={row.original}
            type="onOrder"
            colorClass="text-metric-onorder"
            onDrillDown={onDrillDown}
            uom={uom}
            mbfFactor={row.original.mbfFactor}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQty(rowA.original.onOrder, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQty(rowB.original.onOrder, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 85,
      },
      {
        accessorKey: 'inTransit',
        header: ({ column }) => <SortHeader label="IN TRANSIT" column={column} align="right" />,
        cell: ({ getValue, row }) => (
          <MetricCell
            value={convertQty(getValue() as number, uom ?? 'Packs', row.original.mbfFactor)}
            row={row.original}
            type="inTransit"
            colorClass="text-metric-intransit"
            onDrillDown={onDrillDown}
            uom={uom}
            mbfFactor={row.original.mbfFactor}
          />
        ),
        sortingFn: (rowA, rowB) => {
          const a = convertQty(rowA.original.inTransit, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQty(rowB.original.inTransit, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 90,
      },
      {
        accessorKey: 'available',
        header: ({ column }) => <SortHeader label="AVAILABLE" column={column} align="right" />,
        cell: ({ getValue, row }) => {
          const raw = getValue() as number;
          const f = row.original.mbfFactor;
          if (uom === 'MBF' && (f ?? 0) === 0) {
            return <span className="text-[#7A8FA3] tabular-nums text-right block">N/A</span>;
          }
          const v = convertQty(raw, uom ?? 'Packs', f);
          return (
            <span className="text-metric-onhand font-medium tabular-nums text-right block">
              {v > 0 ? '+' : ''}{formatQty(v, uom)}
            </span>
          );
        },
        sortingFn: (rowA, rowB) => {
          const a = convertQty(rowA.original.available, uom ?? 'Packs', rowA.original.mbfFactor);
          const b = convertQty(rowB.original.available, uom ?? 'Packs', rowB.original.mbfFactor);
          return a - b;
        },
        size: 90,
      },
      {
        accessorKey: 'averageCost',
        header: () => <span className="block text-right">AVG COST</span>,
        cell: ({ getValue }) => {
          const raw = getValue() as number;
          return (
            <span className="tabular-nums font-mono text-xs text-right block">
              {formatCurrency(raw)}
            </span>
          );
        },
        size: 105,
        enableSorting: false,
      },
    ],
    [uom, onDrillDown, onCellFilter, activeFilters]
  );

  // Initialize column order from column definitions (once), and reset on resetKey change
  const defaultOrder = React.useMemo(
    () => columns.map(c => ('accessorKey' in c ? (c.accessorKey as string) : c.id) as string),
    [columns]
  );

  React.useEffect(() => {
    if (columnOrder.length === 0) {
      setColumnOrder(defaultOrder);
    }
  }, [defaultOrder, columnOrder.length]);

  const prevUomRef = React.useRef(uom);
  React.useEffect(() => {
    if (prevUomRef.current !== uom) {
      prevUomRef.current = uom;
      setColumnOrder(defaultOrder);
    }
  }, [uom, defaultOrder]);

  React.useEffect(() => {
    if (resetKey != null && resetKey > 0) {
      setColumnOrder(defaultOrder);
      setSorting([]);
    }
  }, [resetKey, defaultOrder]);

  // DnD sensor — require 5px movement to start drag (avoids conflicts with sort clicks)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setColumnOrder(prev => {
      const oldIdx = prev.indexOf(active.id as string);
      const newIdx = prev.indexOf(over.id as string);
      if (oldIdx === -1 || newIdx === -1) return prev;
      const next = [...prev];
      next.splice(oldIdx, 1);
      next.splice(newIdx, 0, active.id as string);
      return next;
    });
  }, []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection, columnOrder },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.detailKey || `${row.internalId}-${row.locationId}`,
  });

  // Column IDs for SortableContext — exclude 'select' (checkbox stays pinned first)
  const draggableColumnIds = React.useMemo(
    () => table.getHeaderGroups()[0].headers
      .filter(h => h.column.id !== 'select')
      .map(h => h.column.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnOrder]
  );

  return (
    <div className="rounded-md border border-navy-mid/30 overflow-auto flex-1 min-h-0 bg-surface inventory-table-scroll">
      <Table className="w-full" style={{ minWidth: table.getTotalSize(), borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <TableHeader>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={draggableColumnIds} strategy={horizontalListSortingStrategy}>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="sticky top-0 z-10 text-white border-b-0"
                  style={{ background: 'linear-gradient(to bottom, var(--navy), var(--navy-mid))' }}
                >
                  {headerGroup.headers.map((header) => {
                    // Checkbox column: not draggable, stays pinned first
                    if (header.column.id === 'select') {
                      return (
                        <TableHead
                          key={header.id}
                          className="text-center"
                          style={{ width: header.getSize(), padding: '8px 10px', height: 'auto' }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      );
                    }
                    return <DraggableHeader key={header.id} header={header} />;
                  })}
                </TableRow>
              ))}
            </SortableContext>
          </DndContext>
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
                    className={cell.column.id === 'select' ? 'text-center' : 'py-1.5 px-3'}
                    style={{
                      width: cell.column.getSize(),
                      ...(cell.column.id === 'select' ? { padding: '6px 10px' } : {}),
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                No data available
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {totals && (() => {
          const headers = table.getHeaderGroups()[0].headers;
          // Count leading non-metric columns before the first metric column
          let leadingNonMetric = 0;
          for (const h of headers) {
            if (METRIC_COLUMNS.has(h.column.id)) break;
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
                  if (METRIC_COLUMNS.has(colId)) {
                    const isQtyFBM = colId === 'quantityFBM';
                    const val = isQtyFBM ? onHandMbfTotal : totals[colId as keyof typeof totals];
                    const isAvailable = colId === 'available';
                    const color = isAvailable
                      ? (val >= 0 ? FOOTER_LABEL.available : FOOTER_LABEL.availableNeg)
                      : FOOTER_LABEL[colId];
                    const display = isQtyFBM
                      ? (Math.round(val * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : isAvailable
                        ? `${val >= 0 ? '' : '▼'}${formatQty(Math.abs(val), uom)}`
                        : formatQty(val, uom);
                    return (
                      <TableCell key={colId} className="pt-[13px] pb-2.5 px-3" style={{ width: header.getSize() }}>
                        <span className="font-mono text-[12px] font-bold tabular-nums text-right block" style={{ color }}>
                          {display}
                        </span>
                      </TableCell>
                    );
                  }
                  // Non-metric column after metrics (e.g. avgPrice)
                  return <TableCell key={colId} className="pt-[13px] pb-2.5 px-3" style={{ width: header.getSize() }} />;
                })}
              </TableRow>
            </tfoot>
          );
        })()}
      </Table>
    </div>
  );
};

/* Footer label colors for totals row */
const FOOTER_LABEL: Record<string, string> = {
  quantityFBM: '#A5D6A7',
  onHand: '#A5D6A7',
  committed: '#FFB74D',
  outbound: '#F48FB1',
  onOrder: '#90CAF9',
  inTransit: '#CE93D8',
  available: '#A5D6A7',
  availableNeg: '#FCA5A5',
};

const METRIC_COLUMNS = new Set(['quantityFBM', 'onHand', 'committed', 'outbound', 'onOrder', 'inTransit', 'available']);
