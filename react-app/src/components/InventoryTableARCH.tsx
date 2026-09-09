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
import { formatQty, formatCostPerUnit, displaySuffix, unitListLabel } from '@/lib/archUom';
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
 * ✅ OUTBOUND IS BACK, 2026-09-08. The comment that used to sit here said so
 * itself: "If traders query the arithmetic, this is the first thing to put
 * back." Two of them did, on the same day.
 *
 * Marc-Antoine: « quand je crée un SO ça devrait aller dans ready to build ou
 * dans reserved mais en ce moment on dirait qu'il fait juste disparaitre du TS. »
 *
 * What actually happens to a bundle he sells, measured against the sandbox:
 *   1. He writes the SO. The line is open, so the row's RESERVED rises — that
 *      part works, and SO-CWP-001344's 2,160 BF sits in Reserved today.
 *   2. It is fulfilled. RESERVED drops back to zero, ON HAND drops for real
 *      (the Item Fulfillment relieves inventory), and the quantity moves into
 *      `outbound` — which this grid did not render. So the wood left two visible
 *      columns and arrived in none.
 *   3. It never passes through READY TO BUILD, because that bucket is a
 *      hardcoded 0 in the cache with no NetSuite field behind it.
 * Steps 2 and 3 are the disappearance. The column restores the lane in step 2
 * and the header note explains step 3.
 *
 * Outbound is NOT drillable. Its quantity is shipment history, deliberately
 * attributed to no bundle — the wood is gone and the lot's on-hand is already
 * net of it — so a drill-down could only ever open an empty table.
 *
 * ✅ THE COLUMNS NOW RECONCILE, which they did not before:
 *   AVAILABLE = ON HAND + IN TRANSIT + ON ORDER − RESERVED − READY TO BUILD
 *               − held stock
 * with OUTBOUND standing outside the sum, because on-hand is already net of it.
 * Subtracting it as well took the same wood off twice — 1,166 BF across the 13
 * live rows on 2026-09-08, and unbounded, since nothing closes a shipped line.
 * The measurement is in the cache MR beside the formula. All 13 rows reconcile
 * exactly as this stands; 4 of 13 did not before.
 */
const METRIC_COLUMNS: { key: ArchDetailKey; label: string; width: number; drillable?: boolean; note?: string }[] = [
  { key: 'available', label: 'AVAILABLE', width: 105, drillable: true },
  { key: 'onHand', label: 'ON HAND', width: 100, drillable: true },
  { key: 'reserve', label: 'RESERVED', width: 100, drillable: true },
  {
    key: 'readyToBuild',
    label: 'READY TO BUILD',
    width: 130,
    drillable: true,
    // The honest answer to Marc-Antoine's question, on the column he expects to
    // see it in. Kept in step with notSourcedNote() in lib/archBuckets.ts.
    note: 'Not sourced yet: no field in NetSuite feeds this, so it reads 0 on every row. Stock sold on an order sits in Reserved until it ships.',
  },
  {
    key: 'outbound',
    label: 'OUTBOUND',
    width: 100,
    drillable: false,
    note: 'Already shipped out on a sales order. It has left On Hand, so it is NOT deducted from Available a second time. This column is history, not a claim on stock, and no bundle carries it, so there is nothing to drill into.',
  },
  { key: 'inTransit', label: 'IN TRANSIT', width: 105, drillable: true },
  { key: 'onOrder', label: 'ON ORDER', width: 100, drillable: true },
];

const METRIC_IDS = new Set<string>(METRIC_COLUMNS.map((c) => c.key));

const SortHeader = ({
  label,
  column,
  align,
  note,
}: {
  label: string;
  align?: 'left' | 'right';
  /**
   * What this column is, when the number alone would mislead. Carried as a
   * native title so it needs no popover plumbing on a header that is also a
   * drag handle and a sort button.
   */
  note?: string;
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
      title={note}
    >
      {label}
      {/* A column whose number cannot be read at face value says so on the
          header itself, not only in a tooltip nobody hovers. */}
      {note && <span aria-hidden style={{ opacity: 0.75, fontSize: 10 }}>ⓘ</span>}
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
  note,
}: {
  bf: number;
  row: ArchSummaryRow;
  bucket: ArchDetailKey;
  uom: string;
  onDrillDown?: (bucket: ArchDetailKey, row: ArchSummaryRow) => void;
  note?: string;
}) => {
  // A zero carries no information, so it should not shout. The prototype dims
  // them to #7A8FA3 while real values keep their metric colour — and 45% of the
  // numeric cells on this grid are zeros, so at full saturation they drowned out
  // the 55% that mattered.
  const color = bf > 0 ? ARCH_METRIC_COLORS[bucket] : '#7A8FA3';
  // The row's own unit, not a screen-wide one — a veneer row reads in SQFT even
  // when the Lumber rows beside it are showing cubic metres.
  const display = formatQty(bf, row.unit, uom);

  if (onDrillDown && bf > 0) {
    return (
      <button
        type="button"
        onClick={() => onDrillDown(bucket, row)}
        className="hover:underline font-medium tabular-nums text-right w-full block"
        style={{ color }}
        title={note}
      >
        {display}
      </button>
    );
  }
  return (
    <span className="tabular-nums text-right block" style={{ color }} title={bf > 0 ? note : undefined}>
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
    const metricCols: ColumnDef<ArchSummaryRow>[] = METRIC_COLUMNS.map(({ key, label, width, drillable, note }) => ({
      id: key,
      accessorFn: (r) => r[key],
      header: ({ column }) => <SortHeader label={label} column={column} align="right" note={note} />,
      cell: ({ row }) => (
        <MetricCell
          bf={row.original[key]}
          row={row.original}
          bucket={key}
          uom={uom}
          // A non-drillable column renders a plain figure. Passing the handler
          // and hiding the click would leave an underlined, pointer-cursored
          // number that does nothing.
          onDrillDown={drillable ? onDrillDown : undefined}
          note={note}
        />
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
      // CONTAINER # was a column here until 2026-08-19. It is gone because the
      // value it was about to be fed is a PO number, not a container: the lot
      // prefix `316027` is the purchase order, per Marc-Antoine, and a container
      // can span several POs so neither derives from the other. He also asked for
      // it off the main screen. Container still renders on the lot detail tables
      // (ArchLotTable, ArchReservedSection, ArchPOListView), where the PO # column
      // beside it is now populated.
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
        id: 'avgCostPerUnit',
        accessorKey: 'avgCostPerUnit',
        // The header can no longer name the unit — one column spans rows priced
        // per BF, per SQFT and per piece — so each cell carries its own suffix.
        header: ({ column }) => <SortHeader label="AVG COST" column={column} align="right" />,
        cell: ({ row }) => (
          <span className="tabular-nums font-mono text-xs text-right block">
            {formatCostPerUnit(row.original.avgCostPerUnit, row.original.unit)}
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
            // One unit across every visible row is what makes a column total a
            // real number. `units` is empty only when the grid is empty, which
            // the `totals &&` guard above does not exclude on its own.
            const totalsUnit = totals.units[0] ?? 'BF';
            const mixedUnits = totals.units.length > 1;
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
                        {/* Name the units rather than instruct. The old text said
                            "filter by Category to total", which is a dead end —
                            the ARCH cache emits an empty category on every row. */}
                        {mixedUnits
                          ? <span className="normal-case">mixed: {unitListLabel(totals.units)}</span>
                          : displaySuffix(totalsUnit, uom)}
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
                    const value = (totals[colId as keyof ArchTotals] as number) ?? 0;
                    return (
                      <TableCell key={colId} className="pt-[13px] pb-2.5 px-3" style={{ width: header.getSize() }}>
                        <span
                          className="font-mono text-[12px] font-bold tabular-nums text-right block"
                          style={{ color: ARCH_FOOTER_COLORS[colId] }}
                        >
                          {/* Board feet, square feet and pieces do not add up.
                              Printing their sum would be a confident wrong
                              number, so the column goes blank until the grid
                              holds one unit. */}
                          {mixedUnits ? '—' : formatQty(value, totalsUnit, uom)}
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
