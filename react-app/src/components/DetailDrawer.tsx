import * as React from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
// Tabs replaced with custom navy tab bar
// Table components used by InventoryTable; DetailTable uses raw HTML table for POC-matching styles
import { Skeleton } from '@/components/ui/skeleton';
import { useDetailData } from '@/hooks/useDetailData';
import type { DetailType } from '@/hooks/useDetailData';
import type { SummaryRow } from '@/lib/api';

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  locationId: string;
  triggerType: DetailType;
  row?: SummaryRow | null;
  resetCacheVersion?: number | null;
  uom?: string;
}

const MODAL_META: Record<DetailType, { label: string; color: string; bg: string; icon: string }> = {
  onHand:    { label: 'On Hand',    color: '#1B5E20', bg: '#E8F5E9', icon: '\u{1F4E6}' },
  committed: { label: 'Committed',  color: '#E65100', bg: '#FFF8E1', icon: '\u{1F4CB}' },
  outbound:  { label: 'Outbound',   color: '#880E4F', bg: '#FCE4EC', icon: '\u{1F69A}' },
  onOrder:   { label: 'On Order',   color: '#0D47A1', bg: '#E3F2FD', icon: '\u{1F6D2}' },
  inTransit: { label: 'In Transit', color: '#4A148C', bg: '#F3E5F5', icon: '\u{26F5}' },
  available: { label: 'Available',  color: '#1B5E20', bg: '#E8F5E9', icon: '\u2705' },
};

const TAB_LABELS: Record<DetailType, string> = {
  onHand: 'On Hand',
  committed: 'Committed',
  outbound: 'Outbound',
  onOrder: 'On Order',
  inTransit: 'In Transit',
  available: 'Available',
};

interface ColDef {
  id: string;
  label: string;
  link?: boolean;
  numeric?: boolean;
  totalKey?: string;
  format?: 'int' | 'currency';
}

const COLUMN_MAP: Record<DetailType, ColDef[]> = {
  onHand: [
    { id: 'docType', label: 'Document Type', link: true },
    { id: 'docNum', label: 'Document Number', link: true },
    { id: 'reloadId', label: 'Reload ID' },
    { id: 'poWoNumber', label: 'PO/WO Number', link: true },
    { id: 'receiptDate', label: 'Date' },
    { id: 'vendor', label: 'Vendor', link: true },
    { id: 'lotNo', label: 'Lot Number' },
    { id: 'packQty', label: 'Packs on Hand', numeric: true, totalKey: 'qty', format: 'int' },
    { id: 'piecesPerPack', label: 'Pieces Per Pack', numeric: true, format: 'int' },
    { id: 'pricePerPiece', label: 'Price Per Piece', numeric: true, format: 'currency' },
    { id: 'avgPrice', label: 'MBF Price', numeric: true, totalKey: 'price', format: 'currency' },
  ],
  committed: [
    { id: 'docNum', label: 'Document Number', link: true },
    { id: 'customerName', label: 'Customer', link: true },
    { id: 'tranDate', label: 'SO Creation Date' },
    { id: 'expectedShipDate', label: 'Ship Week' },
    { id: 'packCommitted', label: 'Packs Committed', numeric: true, totalKey: 'qty', format: 'int' },
    { id: 'piecesPerPack', label: 'Pieces Per Pack', numeric: true, format: 'int' },
    { id: 'pricePerPiece', label: 'Price Per Piece', numeric: true, format: 'currency' },
    { id: 'rate', label: 'MBF Price', numeric: true, totalKey: 'price', format: 'currency' },
  ],
  outbound: [
    { id: 'docNum', label: 'Document Number', link: true },
    { id: 'customerName', label: 'Customer', link: true },
    { id: 'dueDate', label: 'Invoiced Date' },
    { id: 'packQty', label: 'Packs', numeric: true, totalKey: 'qty', format: 'int' },
    { id: 'piecesPerPack', label: 'Pieces Per Pack', numeric: true, format: 'int' },
    { id: 'pricePerPiece', label: 'Price Per Piece', numeric: true, format: 'currency' },
    { id: 'rate', label: 'MBF Price', numeric: true, totalKey: 'price', format: 'currency' },
  ],
  onOrder: [
    { id: 'docNum', label: 'Document Number', link: true },
    { id: 'vendorName', label: 'Vendor', link: true },
    { id: 'shipDate', label: 'Ship Week' },
    { id: 'packQty', label: 'Packs', numeric: true, totalKey: 'qty', format: 'int' },
    { id: 'piecesPerPack', label: 'Pieces Per Pack', numeric: true, format: 'int' },
    { id: 'pricePerPiece', label: 'Price Per Piece', numeric: true, format: 'currency' },
    { id: 'rate', label: 'MBF Price', numeric: true, totalKey: 'price', format: 'currency' },
  ],
  inTransit: [
    { id: 'docNum', label: 'Document Number', link: true },
    { id: 'shipWeek', label: 'Ship Week' },
    { id: 'vendor', label: 'Vendor', link: true },
    { id: 'packQty', label: 'Packs', numeric: true, totalKey: 'qty', format: 'int' },
    { id: 'piecesPerPack', label: 'Pieces Per Pack', numeric: true, format: 'int' },
    { id: 'pricePerPiece', label: 'Price Per Piece', numeric: true, format: 'currency' },
    { id: 'rate', label: 'MBF Price', numeric: true, totalKey: 'price', format: 'currency' },
  ],
  available: [],
};

// Pack counts are whole numbers in the common case, but a partially-shipped lot
// leaves a fraction of a pack on hand (reman lots are 1 pack by construction, so
// any remainder is < 1). Math.round() rendered those as "0"; show 2 decimals only
// when there is a real fraction, so the usual integers don't all gain a ".00".
function formatPackQty(val: number): string {
  // `|| 0` normalizes -0, which Intl renders as "-0" since ES2020.
  const rounded = Math.round(val * 100) / 100 || 0;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function makeDescription(row: SummaryRow): string {
  const parts: string[] = [];
  if (row.species) parts.push(row.species);
  if (row.thickness) parts.push(row.thickness);
  if (row.width) parts.push('x' + row.width);
  if (row.length) parts.push(row.length);
  if (row.grade) parts.push(row.grade);
  return parts.join(' ') || row.itemName || '';
}

export const DetailDrawer = ({
  open,
  onOpenChange,
  itemId,
  locationId,
  triggerType,
  row,
  resetCacheVersion,
  uom,
}: DetailDrawerProps) => {
  const isMBF = uom === 'MBF';
  const mbfFactor = row?.mbfFactor ?? 0;
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

  const meta = MODAL_META[activeTab];

  const headerTotal = React.useMemo(() => {
    const tabData = data?.[activeTab] as Record<string, unknown>[] | undefined;
    let raw: number;
    if (!tabData?.length) {
      raw = (row?.[activeTab as keyof SummaryRow] as number) || 0;
    } else {
      const qtyField = COLUMN_MAP[activeTab].find(c => c.totalKey === 'qty')?.id;
      if (!qtyField) return 0;
      raw = tabData.reduce((sum, r) => sum + (Number(r[qtyField]) || 0), 0);
    }
    if (isMBF) {
      if (mbfFactor === 0) return 0;
      return Math.round(raw * mbfFactor * 100) / 100;
    }
    return raw;
  }, [data, activeTab, row, isMBF, mbfFactor]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] max-h-[85vh] flex flex-col overflow-hidden p-0">
        {/* Rich header */}
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 100%)',
            borderRadius: '14px 14px 0 0',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
              style={{ background: meta.bg }}
            >
              {meta.icon}
            </div>
            <div>
              <div className="text-white text-[15px] font-bold">
                {meta.label} — Transaction Detail
              </div>
              <div className="text-white/55 text-xs font-mono mt-0.5">
                {row?.itemCode || itemId}
                {row?.locationName ? ` · ${row.locationName}` : ''}
                {row?.grade ? ` · Grade ${row.grade}` : ''}
              </div>
              {row && (
                <div className="text-white/70 text-[11px] mt-0.5">
                  {makeDescription(row)}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {row && (
              <div className="text-right">
                <div className="text-white/45 text-[10px] uppercase tracking-wider">Total</div>
                <div className="font-mono text-[16px] font-bold" style={{ color: meta.bg }}>
                  {isMBF && mbfFactor === 0
                    ? 'N/A'
                    : isMBF
                      ? (Math.round(headerTotal * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                      : formatPackQty(headerTotal)}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white/70 hover:text-white text-lg"
              style={{ background: 'rgba(255,255,255,0.12)' }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Tabs + content */}
        <div className="flex flex-col flex-1 overflow-hidden px-5 pb-5 pt-3">
            <div
              className="grid w-full grid-cols-5 flex-shrink-0 rounded-lg overflow-hidden"
              style={{ background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 100%)' }}
            >
              {(['onHand', 'committed', 'outbound', 'onOrder', 'inTransit'] as DetailType[]).map((t) => {
                const isActive = activeTab === t;
                const tabMeta = MODAL_META[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActiveTab(t)}
                    style={{
                      padding: '8px 4px',
                      fontSize: 11,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                      background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
                      borderBottom: isActive ? `2px solid ${tabMeta.color}` : '2px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        e.currentTarget.style.color = '#fff';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    {TAB_LABELS[t]}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex-1 overflow-auto">
              {loading ? (
                <Skeleton className="h-64 w-full" />
              ) : error ? (
                <p className="text-destructive">{error}</p>
              ) : data?.[activeTab]?.length ? (
                <DetailTable
                  rows={data[activeTab] as Record<string, unknown>[]}
                  columns={COLUMN_MAP[activeTab]}
                  meta={MODAL_META[activeTab]}
                  uom={uom}
                  mbfFactor={mbfFactor}
                />
              ) : (
                <p className="text-muted-foreground">No data</p>
              )}
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface DetailTableProps {
  rows: Record<string, unknown>[];
  columns: ColDef[];
  meta: { color: string; bg: string };
  uom?: string;
  mbfFactor?: number;
}

const DetailTable = ({ rows, columns, meta, uom, mbfFactor }: DetailTableProps) => {
  const isMBF = uom === 'MBF';
  const factor = mbfFactor ?? 0;
  const canConvert = isMBF && factor > 0;

  // Adjust qty column labels for MBF
  const effectiveColumns = React.useMemo(() => {
    if (!isMBF) return columns;
    return columns.map(col => {
      if (col.totalKey !== 'qty') return col;
      const label = col.label
        .replace('Packs on Hand', 'MBF On Hand')
        .replace('Packs Committed', 'MBF Committed')
        .replace('Packs', 'MBF');
      return { ...col, label };
    });
  }, [columns, isMBF]);

  const qtyField = effectiveColumns.find(c => c.totalKey === 'qty')?.id;
  const visibleRows = React.useMemo(() => {
    if (!qtyField) return rows;
    return rows.filter(r => (Number(r[qtyField]) || 0) > 0);
  }, [rows, qtyField]);

  const totals = React.useMemo(() => {
    const result: Record<string, number> = {};
    for (const col of effectiveColumns) {
      if (col.totalKey === 'qty') {
        const rawTotal = rows.reduce((sum, r) => sum + (Number(r[col.id]) || 0), 0);
        result[col.id] = canConvert
          ? Math.round(rawTotal * factor * 100) / 100
          : rawTotal;
      } else if (col.totalKey === 'price' && qtyField) {
        const totalQty = rows.reduce((sum, r) => sum + (Number(r[qtyField]) || 0), 0);
        result[col.id] = totalQty > 0
          ? rows.reduce((sum, r) => sum + (Number(r[qtyField]) || 0) * (Number(r[col.id]) || 0), 0) / totalQty
          : 0;
      }
    }
    return result;
  }, [rows, effectiveColumns, canConvert, factor, qtyField]);

  return (
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, tableLayout: 'auto' }}>
      <thead>
        <tr>
          {effectiveColumns.map((col) => (
            <th
              key={col.id}
              style={{
                padding: '8px 10px',
                background: 'linear-gradient(to bottom, #F1F5FA, #E8EDF5)',
                color: '#3D5166',
                fontWeight: 700,
                fontSize: 10.5,
                textAlign: col.numeric ? 'right' : 'left',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                borderBottom: '2px solid #CBD5E1',
                borderRight: '1px solid #E2E8F0',
                whiteSpace: 'nowrap',
                position: 'sticky',
                top: 0,
                zIndex: 2,
              }}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((row, i) => (
          <tr
            key={i}
            style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#EEF7EF'; }}
            onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#F8FAFC'; }}
          >
            {effectiveColumns.map((col) => {
              const rawVal = row[col.id];
              const isQtyCol = col.totalKey === 'qty';
              const val = isQtyCol && isMBF
                ? (canConvert ? Math.round(Number(rawVal || 0) * factor * 100) / 100 : null)
                : rawVal;
              const linkUrl = col.id === 'docNum' || col.id === 'docType' ? row.docUrl
                : col.id === 'vendor' || col.id === 'vendorName' ? row.vendorUrl
                : col.id === 'customerName' ? row.customerUrl
                : col.id === 'poWoNumber' ? row.poWoUrl
                : undefined;
              return (
                <td
                  key={col.id}
                  style={{
                    padding: '7px 10px',
                    borderBottom: '1px solid #E2E8F0',
                    borderRight: '1px solid rgba(226,232,240,0.33)',
                    textAlign: col.numeric ? 'right' : 'left',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {col.link && linkUrl ? (
                    <a
                      href={String(linkUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#1A3D63', fontWeight: 400, fontSize: 11, textDecoration: 'none', cursor: 'pointer' }}
                    >
                      {String(val ?? '')}
                    </a>
                  ) : col.numeric ? (
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontWeight: 700,
                        color: isQtyCol && isMBF && !canConvert ? '#7A8FA3' : isQtyCol ? meta.color : col.totalKey === 'price' ? '#7A4100' : '#3D5166',
                      }}
                    >
                      {isQtyCol && isMBF && !canConvert
                        ? 'N/A'
                        : typeof val === 'number'
                          ? isQtyCol && isMBF
                            ? (Math.round(val * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                            : col.format === 'int'
                              ? formatPackQty(val)
                              : col.format === 'currency'
                                ? `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : String(val ?? '—')}
                    </span>
                  ) : (
                    <span style={{ color: '#3D5166', fontSize: 11 }}>{String(val ?? '—')}</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ background: '#F1F5FA' }}>
          {effectiveColumns.map((col, i) => (
            <td
              key={col.id}
              style={{
                padding: '7px 12px',
                borderTop: '2px solid #CBD5E1',
                textAlign: col.numeric ? 'right' : 'left',
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              {i === 0 ? (
                <span style={{ color: '#0D1F33', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 13 }}>
                  TOTAL
                </span>
              ) : col.totalKey === 'qty' ? (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: isMBF && !canConvert ? '#7A8FA3' : meta.color, fontSize: 13 }}>
                  {isMBF && !canConvert
                    ? 'N/A'
                    : isMBF
                      ? (Math.round((totals[col.id] || 0) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                      : formatPackQty(totals[col.id] || 0)}
                </span>
              ) : null}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
};
