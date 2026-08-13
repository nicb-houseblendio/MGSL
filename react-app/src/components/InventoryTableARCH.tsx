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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatArchQty, formatCostPerBF, uomSuffix } from '@/lib/archUom';
import { ARCH_METRIC_COLORS, ARCH_FOOTER_COLORS } from '@/components/arch/archColors';
import type { ArchSummaryRow, ArchDetailKey, ArchTotals } from '@/types/arch';

interface InventoryTableARCHProps {
  data: ArchSummaryRow[];
  onDrillDown?: (bucket: ArchDetailKey, row: ArchSummaryRow) => void;
  onCellFilter?: (filterKey: string, value: string) => void;
  activeFilters?: Record<string, string[]>;
  onRowSelectionChange?: (selection: Record<string, boolean>) => void;
  resetKey?: number;
  totals?: ArchTotals;
  rowCount?: number;
  uom: string;
}

/**
 * Metric columns, in the order stock moves through them.
 *
 * Matches the client prototype exactly: six buckets, no Outbound column.
 *
 * ⚠️ KNOWN CONSEQUENCE. Available is
 *   onHand + onOrder + inTransit − reserve − readyToBuild − outbound,
 * so on the rows that carry outbound stock a trader adding up the visible
 * columns will not arrive at Available. We showed Outbound for exactly that
 * reason and removed it on 2026-08-13 to match the prototype, which omits the
 * column while still generating outbound quantities — so its Available does not
 * reconcile either. Outbound is still in the Excel export, where a reconciling
 * column is worth more than the width it costs. If traders query the arithmetic,
 * this is the first thing to put back.
 */
const METRIC_COLUMNS: { key: ArchDetailKey; label: string; width: number }[] = [
  { key: 'available', label: 'AVAILABLE', width: 105 },
  { key: 'onHand', label: 'ON HAND', width: 100 },
  { key: 'reserve', label: 'RESERVED', width: 100 },
  { key: 'readyToBuild', label: 'READY TO BUILD', width: 130 },
  { key: 'inTransit', label: 'IN TRANSIT', width: 105 },
  { key: 'onOrder', label: 'ON ORDER', width: 100 },
];

const METRIC_IDS = new Set<string>(METRIC_COLUMNS.map((c) => c.key));

const SortHeader = ({
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

const DraggableHeader = ({ header }: { header: Header<ArchSummaryRow, unknown> }) => {
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
      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
    </TableHead>
  );
};

/** A clickable attribute cell that toggles a filter. */
const AttrCell = ({
  value,
  filterKey,
  filterValue,
  activeFilters,
  onCellFilter,
  mono,
}: {
  value: string;
  filterKey: string;
  filterValue: string;
  activeFilters?: Record<string, string[]>;
  onCellFilter?: (filterKey: string, value: string) => void;
  mono?: boolean;
}) => {
  if (!value) return <span className="text-xs">—</span>;
  const active = activeFilters?.[filterKey]?.includes(filterValue);
  return (
    <button
      type="button"
      onClick={() => onCellFilter?.(filterKey, filterValue)}
      className={`w-full block text-xs text-left hover:underline cursor-pointer ${mono ? 'font-mono' : ''} ${
        active ? 'font-bold text-[#1E6B47] bg-[#1E6B47]/10 px-1 rounded' : ''
      }`}
    >
      {value}
    </button>
  );
};

const MetricCell = ({
  bf,
  row,
  bucket,
  uom,
  onDrillDown,
}: {
  bf: number;
  row: ArchSummaryRow;
  bucket: ArchDetailKey;
  uom: string;
  onDrillDown?: (bucket: ArchDetailKey, row: ArchSummaryRow) => void;
}) => {
  // A zero carries no information, so it should not shout. The prototype dims
  // them to #7A8FA3 while real values keep their metric colour — and 45% of the
  // numeric cells on this grid are zeros, so at full saturation they drowned out
  // the 55% that mattered.
  const color = bf > 0 ? ARCH_METRIC_COLORS[bucket] : '#7A8FA3';
  const display = formatArchQty(bf, uom);

  if (onDrillDown && bf > 0) {
    return (
      <button
        type="button"
        onClick={() => onDrillDown(bucket, row)}
        className="hover:underline font-medium tabular-nums text-right w-full block"
        style={{ color }}
      >
        {display}
      </button>
    );
  }
  return (
    <span className="tabular-nums text-right block" style={{ color }}>
      {display}
    </span>
  );
};

export const InventoryTableARCH = ({
  data,
  onDrillDown,
  onCellFilter,
  activeFilters,
  onRowSelectionChange,
  resetKey,
  totals,
  rowCount,
  uom,
}: InventoryTableARCHProps) => {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([]);

  React.useEffect(() => {
    onRowSelectionChange?.(rowSelection);
  }, [rowSelection, onRowSelectionChange]);

  const columns = React.useMemo<ColumnDef<ArchSummaryRow>[]>(() => {
    const metricCols: ColumnDef<ArchSummaryRow>[] = METRIC_COLUMNS.map(({ key, label, width }) => ({
      id: key,
      accessorFn: (r) => r[key],
      header: ({ column }) => <SortHeader label={label} column={column} align="right" />,
      cell: ({ row }) => (
        <MetricCell bf={row.original[key]} row={row.original} bucket={key} uom={uom} onDrillDown={onDrillDown} />
      ),
      sortingFn: (a, b) => a.original[key] - b.original[key],
      size: width,
    }));

    return [
      // The prototype's grid has NO selection checkbox. Removed 2026-08-13 to
      // match. `selectedArchRows` already falls back to every row when nothing is
      // selected, so Export Excel now simply exports what is filtered. The
      // selection plumbing is left in place so the column can be restored in one
      // edit if traders ask for per-row export.
      {
        id: 'description',
        accessorKey: 'description',
        header: ({ column }) => <SortHeader label="ITEM DESCRIPTION" column={column} />,
        cell: ({ row }) => (
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
            {row.original.description}
          </span>
        ),
        size: 205,
      },
      {
        id: 'containerNo',
        accessorKey: 'containerNo',
        header: ({ column }) => <SortHeader label="CONTAINER #" column={column} />,
        cell: ({ row }) => {
          const containers = row.original.containers;
          if (!containers.length) return <span className="font-mono text-xs">—</span>;
          const first = containers[0];
          return (
            <div className="flex items-center gap-1">
              <AttrCell
                value={first}
                filterKey="containerNo"
                filterValue={first}
                activeFilters={activeFilters}
                onCellFilter={onCellFilter}
                mono
              />
              {containers.length > 1 && (
                <span
                  className="text-[9px] font-bold px-1 rounded shrink-0"
                  style={{ background: 'var(--border)', color: 'var(--text-mid)' }}
                  title={containers.join('\n')}
                >
                  +{containers.length - 1}
                </span>
              )}
            </div>
          );
        },
        size: 135,
      },
      {
        id: 'location',
        accessorKey: 'locationName',
        header: ({ column }) => <SortHeader label="LOCATION" column={column} />,
        cell: ({ row }) => (
          <AttrCell
            value={row.original.locationName}
            filterKey="location"
            filterValue={row.original.locationId}
            activeFilters={activeFilters}
            onCellFilter={onCellFilter}
          />
        ),
        size: 150,
      },
      // Species and Category are FILTERS in the prototype, not columns. They were
      // added here and taken back out on 2026-08-13 to match. Both remain
      // filterable from the panel, and clicking an attribute cell still toggles
      // its filter on the columns that are left.
      ...metricCols,
      {
        id: 'avgCostBF',
        accessorKey: 'avgCostBF',
        header: ({ column }) => <SortHeader label="AVG COST/BF" column={column} align="right" />,
        cell: ({ row }) => (
          <span className="tabular-nums font-mono text-xs text-right block">
            {formatCostPerBF(row.original.avgCostBF)}
          </span>
        ),
        size: 115,
      },
    ];
  }, [uom, onDrillDown, onCellFilter, activeFilters]);

  const defaultOrder = React.useMemo(
    () => columns.map((c) => c.id as string),
    [columns]
  );

  React.useEffect(() => {
    if (columnOrder.length === 0) setColumnOrder(defaultOrder);
  }, [defaultOrder, columnOrder.length]);

  React.useEffect(() => {
    if (resetKey != null && resetKey > 0) {
      setColumnOrder(defaultOrder);
      setSorting([]);
    }
  }, [resetKey, defaultOrder]);

  // 5px activation distance keeps a drag from swallowing a sort click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((prev) => {
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
    getRowId: (row) => row.detailKey,
  });

  const draggableColumnIds = React.useMemo(
    () =>
      table
        .getHeaderGroups()[0]
        .headers.filter((h) => h.column.id !== 'select')
        .map((h) => h.column.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnOrder]
  );

  return (
    <div className="rounded-md border border-navy-mid/30 overflow-auto flex-1 min-h-0 bg-surface inventory-table-scroll">
      <Table
        className="w-full"
        style={{ minWidth: table.getTotalSize(), borderCollapse: 'collapse', tableLayout: 'fixed' }}
      >
        <TableHeader>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={draggableColumnIds} strategy={horizontalListSortingStrategy}>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="sticky top-0 z-10 text-white border-b-0"
                  style={{ background: 'linear-gradient(to bottom, var(--navy), var(--navy-mid))' }}
                >
                  {headerGroup.headers.map((header) =>
                    header.column.id === 'select' ? (
                      <TableHead
                        key={header.id}
                        className="text-center"
                        style={{ width: header.getSize(), padding: '8px 10px', height: 'auto' }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ) : (
                      <DraggableHeader key={header.id} header={header} />
                    )
                  )}
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

        {totals &&
          (() => {
            const headers = table.getHeaderGroups()[0].headers;
            let leadingNonMetric = 0;
            for (const h of headers) {
              if (METRIC_IDS.has(h.column.id)) break;
              leadingNonMetric++;
            }
            return (
              <tfoot>
                {/* bottom:-1 (not 0) avoids a subpixel gap under the sticky footer */}
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
                      <span className="text-[12px] font-semibold tracking-wider text-white/70 whitespace-nowrap">
                        <span className="uppercase">Totals · {rowCount ?? 0} items · </span>
                        {/* Not uppercased — "m³" is a unit symbol, "M³" is wrong. */}
                        {uomSuffix(uom)}
                      </span>
                    </TableCell>
                  )}
                  {headers.slice(leadingNonMetric).map((header) => {
                    const colId = header.column.id;
                    if (!METRIC_IDS.has(colId)) {
                      return (
                        <TableCell key={colId} className="pt-[13px] pb-2.5 px-3" style={{ width: header.getSize() }} />
                      );
                    }
                    const value = totals[colId as keyof ArchTotals] ?? 0;
                    return (
                      <TableCell key={colId} className="pt-[13px] pb-2.5 px-3" style={{ width: header.getSize() }}>
                        <span
                          className="font-mono text-[12px] font-bold tabular-nums text-right block"
                          style={{ color: ARCH_FOOTER_COLORS[colId] }}
                        >
                          {formatArchQty(value, uom)}
                        </span>
                      </TableCell>
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

/**
 * Rows to export: the ticked ones, or everything on screen if nothing is ticked.
 *
 * The intersection matters. Row selection survives a filter change (keyed by
 * detailKey), so a user can tick rows, narrow the filters until none of them are
 * visible, and hit export — a naive intersection would then hand them an empty
 * spreadsheet. Fall back to the visible rows instead.
 */
export const selectedArchRows = (
  rows: ArchSummaryRow[],
  selection: Record<string, boolean>
): ArchSummaryRow[] => {
  const keys = Object.keys(selection).filter((k) => selection[k]);
  if (!keys.length) return rows;
  const set = new Set(keys);
  const picked = rows.filter((r) => set.has(r.detailKey));
  return picked.length ? picked : rows;
};
