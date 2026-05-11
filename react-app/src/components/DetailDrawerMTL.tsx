import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useDetailData } from '@/hooks/useDetailData';
import type { DetailType } from '@/hooks/useDetailData';
import type { SummaryRow } from '@/lib/api';
import { AvailableTabMTL, buildPOGroups } from '@/components/AvailableTabMTL';
import { CurrencyBadge } from '@/components/InventoryTableMTL';

interface DetailDrawerMTLProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: DetailType | null;
  row: SummaryRow | null;              // source of header fields + mbfFactor; null guard required
  uom: string;
  subsidiaryId: string;
  resetCacheVersion?: number | null;   // pass meta?.cacheVersion from App.tsx
}

// ── Tab / meta config ────────────────────────────────────────────────────────

const TAB_LABELS_MTL: Record<string, string> = {
  onHand:    'On Hand',
  committed: 'Committed',
  outbound:  'Outbound',
  onOrder:   'On Order',
  inTransit: 'In Transit',
  available: 'Available',
};

const MODAL_META_MTL: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  onHand:    { label: 'On Hand',    color: '#1B5E20', bg: '#E8F5E9', icon: '\u{1F4E6}' },
  committed: { label: 'Committed',  color: '#E65100', bg: '#FFF8E1', icon: '\u{1F4CB}' },
  outbound:  { label: 'Outbound',   color: '#880E4F', bg: '#FCE4EC', icon: '\u{1F69A}' },
  onOrder:   { label: 'On Order',   color: '#0D47A1', bg: '#E3F2FD', icon: '\u{1F6D2}' },
  inTransit: { label: 'In Transit', color: '#4A148C', bg: '#F3E5F5', icon: '\u{26F5}' },
  available: { label: 'Available',  color: '#1B5E20', bg: '#E8F5E9', icon: '\u2705' },
};

// ── Column definitions ───────────────────────────────────────────────────────

interface MTLColDef {
  id: string;
  label: string;
  link?: boolean;        // Render as clickable hyperlink (uses URL mapping below)
  numeric?: boolean;
  isQty?: boolean;       // UoM conversion applies; label adapts Packs → MBF
  isAging?: boolean;     // Computed from d.date, colored badge
  isStatus?: boolean;    // Colored status badge (Available tab)
  onHandOnly?: boolean;  // Show '—' for non-On-Hand rows in Available tab
  isMbfPrice?: boolean;  // Currency format
  isInt?: boolean;       // Integer format (Pcs/Pack)
  isCurrency?: boolean;  // CurrencyBadge (CAD/USD pill)
}

const COLUMN_MAP_MTL: Record<string, MTLColDef[]> = {
  onHand: [
    { id: 'docNumber',     label: 'Document #',     link: true },
    { id: 'date',          label: 'Date' },
    { id: 'aging',         label: 'Aging',          isAging: true },
    { id: 'vendor',        label: 'Vendor',          link: true },
    { id: 'lotNumber',     label: 'Lot #',           link: true },
    { id: 'packsOnHand',   label: 'Packs On Hand',  numeric: true, isQty: true },
    { id: 'piecesPerPack', label: 'Pcs/Pack',        numeric: true, isInt: true },
    { id: 'mbfPrice',      label: 'MBF Price',       numeric: true, isMbfPrice: true },
    { id: 'lotCost',       label: 'Lot Cost',        numeric: true, isMbfPrice: true },
    { id: 'currency',      label: 'Currency',     isCurrency: true },
  ],
  committed: [
    { id: 'docNumber',      label: 'Document #',          link: true },
    { id: 'customer',       label: 'Customer',             link: true },
    { id: 'soCreationDate', label: 'SO Creation Date' },
    { id: 'shipWeek',       label: 'Ship Week' },
    { id: 'allocatedPO',    label: 'Allocated from PO #',  link: true },
    { id: 'vendor',         label: 'Vendor',               link: true },
    { id: 'lotNumber',      label: 'Lot #',                link: true },
    { id: 'packsCommitted', label: 'Packs Committed', numeric: true, isQty: true },
    { id: 'piecesPerPack',  label: 'Pcs/Pack',         numeric: true, isInt: true },
    { id: 'mbfPrice',       label: 'MBF Price',        numeric: true, isMbfPrice: true },
    { id: 'currency',       label: 'Currency',  isCurrency: true },
  ],
  outbound: [
    { id: 'docNumber',     label: 'Document #',  link: true },
    { id: 'lotNumber',     label: 'Lot #',        link: true },
    { id: 'customer',      label: 'Customer',     link: true },
    { id: 'vendor',        label: 'Vendor',       link: true },
    { id: 'packs',         label: 'Packs',   numeric: true, isQty: true },
    { id: 'piecesPerPack', label: 'Pcs/Pack', numeric: true, isInt: true },
    { id: 'mbfPrice',      label: 'MBF Price', numeric: true, isMbfPrice: true },
    { id: 'currency',      label: 'Currency',     isCurrency: true },
  ],
  onOrder: [
    { id: 'docNumber',     label: 'Document #',  link: true },
    { id: 'vendor',        label: 'Vendor',       link: true },
    { id: 'shipWeek',      label: 'Ship Week' },
    { id: 'packs',         label: 'Packs',   numeric: true, isQty: true },
    { id: 'piecesPerPack', label: 'Pcs/Pack', numeric: true, isInt: true },
    { id: 'mbfPrice',      label: 'MBF Price', numeric: true, isMbfPrice: true },
    { id: 'currency',      label: 'Currency',     isCurrency: true },
  ],
  inTransit: [
    { id: 'docNumber',     label: 'Document #',  link: true },
    { id: 'shipWeek',      label: 'Ship Week' },
    { id: 'vendor',        label: 'Vendor',       link: true },
    { id: 'packs',         label: 'Packs',   numeric: true, isQty: true },
    { id: 'piecesPerPack', label: 'Pcs/Pack', numeric: true, isInt: true },
    { id: 'mbfPrice',      label: 'MBF Price', numeric: true, isMbfPrice: true },
    { id: 'currency',      label: 'Currency',     isCurrency: true },
  ],
  available: [
    { id: 'docNumber',     label: 'Document #', link: true },
    { id: 'date',          label: 'Date',          onHandOnly: true },
    { id: 'aging',         label: 'Aging',         isAging: true, onHandOnly: true },
    { id: 'vendor',        label: 'Vendor', link: true },
    { id: 'lotNumber',     label: 'Lot #',         onHandOnly: true, link: true },
    { id: 'status',        label: 'Status',        isStatus: true },
    { id: 'packsAvail',    label: 'Packs Available', numeric: true, isQty: true },
    { id: 'piecesPerPack', label: 'Pcs/Pack',       numeric: true, isInt: true },
    { id: 'mbfPrice',      label: 'MBF Price',      numeric: true, isMbfPrice: true },
    { id: 'currency',      label: 'Currency',     isCurrency: true },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEffectiveCols(cols: MTLColDef[], uom: string): MTLColDef[] {
  if (uom === 'Packs') return cols;
  return cols.map((col) => {
    if (!col.isQty) return col;
    const label = col.label
      .replace('Packs On Hand', 'MBF On Hand')
      .replace('Packs Committed', 'MBF Committed')
      .replace('Packs Available', 'MBF Available')
      .replace(/^Packs$/, 'MBF');
    return { ...col, label };
  });
}

const getAgingInfo = (dateVal: unknown): { style: React.CSSProperties; text: string } => {
  if (!dateVal || typeof dateVal !== 'string') return { style: { color: '#7A8FA3' }, text: '—' };
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return { style: { color: '#7A8FA3' }, text: '—' };
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  const text = `${days}d`;
  if (days > 90) return { style: { color: '#B22222', fontWeight: 600 }, text };
  if (days >= 30) return { style: { color: '#B58A00', fontWeight: 600 }, text };
  return { style: { color: '#7A8FA3' }, text };
};

const StatusBadge = ({ status }: { status: unknown }) => {
  if (!status || typeof status !== 'string') return <span style={{ color: '#7A8FA3' }}>—</span>;
  const cfg: Record<string, { bg: string; color: string; border: string }> = {
    'On Hand':    { bg: '#E8F5E9', color: '#1B5E20', border: '#A5D6A7' },
    'On Order':   { bg: '#E3F2FD', color: '#0D47A1', border: '#90CAF9' },
    'In Transit': { bg: '#F3E5F5', color: '#4A148C', border: '#CE93D8' },
    'Committed':  { bg: '#FFF3E0', color: '#E65100', border: '#FFB74D' },
  };
  const s = cfg[status] ?? { bg: '#F5F5F5', color: '#3D5166', border: '#CBD5E1' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        padding: '2px 7px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {status}
    </span>
  );
};

const CELL_STYLE = (numeric: boolean): React.CSSProperties => ({
  padding: '7px 10px',
  borderBottom: '1px solid #E2E8F0',
  borderRight: '1px solid rgba(226,232,240,0.33)',
  textAlign: numeric ? 'right' : 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

// ── DetailTableMTL ───────────────────────────────────────────────────────────

interface DetailTableMTLProps {
  rows: Record<string, unknown>[];
  columns: MTLColDef[];
  meta: { color: string; bg: string };
  uom: string;
  mbfFactor: number;
}

const DetailTableMTL = ({ rows, columns, meta, uom, mbfFactor }: DetailTableMTLProps) => {
  const isMBF = uom === 'MBF';
  const canConvert = isMBF && mbfFactor > 0;

  const effectiveCols = React.useMemo(() => getEffectiveCols(columns, uom), [columns, uom]);
  const qtyCol = effectiveCols.find((c) => c.isQty);
  const isAvailTab = columns.some((c) => c.isStatus);

  const visibleRows = rows;

  const totalQty = React.useMemo(() => {
    if (!qtyCol) return 0;
    const raw = rows.reduce((sum, r) => sum + (Number(r[qtyCol.id]) || 0), 0);
    return canConvert ? Math.round(raw * mbfFactor * 100) / 100 : raw;
  }, [rows, qtyCol, canConvert, mbfFactor]);

  return (
    <table
      style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, tableLayout: 'auto' }}
    >
      <thead>
        <tr>
          {effectiveCols.map((col) => (
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
        {visibleRows.map((d, i) => {
          const rowIsOnHand = !isAvailTab || d.status === 'On Hand';
          const rowBg = i % 2 === 0 ? '#fff' : '#F8FAFC';
          return (
            <tr
              key={i}
              style={{ background: rowBg }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#EEF7EF'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = rowBg; }}
            >
              {effectiveCols.map((col) => {
                const rawVal = d[col.id];

                // onHandOnly fields show '—' for non-On-Hand rows in Available tab
                if (col.onHandOnly && !rowIsOnHand) {
                  return (
                    <td key={col.id} style={CELL_STYLE(col.numeric ?? false)}>
                      <span style={{ color: '#7A8FA3' }}>—</span>
                    </td>
                  );
                }

                // Aging — computed from d.date
                if (col.isAging) {
                  const { style, text } = getAgingInfo(d.date);
                  return (
                    <td key={col.id} style={CELL_STYLE(false)}>
                      <span style={{ ...style, fontFamily: 'monospace', fontSize: 11 }}>{text}</span>
                    </td>
                  );
                }

                // Status badge
                if (col.isStatus) {
                  return (
                    <td key={col.id} style={CELL_STYLE(false)}>
                      <StatusBadge status={rawVal} />
                    </td>
                  );
                }

                // Quantity with UoM conversion
                if (col.isQty) {
                  const raw = Number(rawVal || 0);
                  const isDeduction = raw < 0;
                  const absRaw = Math.abs(raw);
                  const display = canConvert ? Math.round(absRaw * mbfFactor * 100) / 100 : absRaw;
                  const formatted = isMBF && !canConvert
                    ? 'N/A'
                    : isMBF
                      ? (Math.round(display * 10) / 10).toLocaleString(undefined, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })
                      : Math.round(display).toLocaleString(undefined, { maximumFractionDigits: 0 });
                  return (
                    <td key={col.id} style={CELL_STYLE(true)}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: isDeduction ? '#E65100' : (isMBF && !canConvert ? '#7A8FA3' : meta.color) }}>
                        {isMBF && !canConvert ? 'N/A' : isDeduction ? `(${formatted})` : formatted}
                      </span>
                    </td>
                  );
                }

                // MBF Price / Lot Cost (currency)
                if (col.isMbfPrice) {
                  // null / undefined → dash (no data). 0 preserved as "$0.00" (legitimate zero).
                  if (rawVal == null) {
                    return (
                      <td key={col.id} style={CELL_STYLE(true)}>
                        <span style={{ color: '#7A8FA3' }}>—</span>
                      </td>
                    );
                  }
                  const n = Number(rawVal);
                  return (
                    <td key={col.id} style={CELL_STYLE(true)}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: '#7A4100' }}>
                        {n === 0
                          ? '$0.00'
                          : `$${n.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`}
                      </span>
                    </td>
                  );
                }

                // Integer (Pcs/Pack)
                if (col.isInt) {
                  const n = Number(rawVal || 0);
                  return (
                    <td key={col.id} style={CELL_STYLE(true)}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: '#3D5166' }}>
                        {n === 0 ? '0' : Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </td>
                  );
                }

                // Currency badge (CAD/USD pill)
                if (col.isCurrency) {
                  const cur = rawVal == null || rawVal === '' ? '' : String(rawVal);
                  return (
                    <td key={col.id} style={CELL_STYLE(false)}>
                      {cur ? <CurrencyBadge currency={cur} /> : <span style={{ color: '#7A8FA3' }}>—</span>}
                    </td>
                  );
                }

                // Default: text (with optional hyperlink)
                const text = rawVal == null || rawVal === '' ? '—' : String(rawVal);
                const linkUrl = col.link
                  ? (col.id === 'docNumber' || col.id === 'docType' ? d.docUrl
                    : col.id === 'vendor' ? d.vendorUrl
                    : col.id === 'customer' ? d.customerUrl
                    : col.id === 'poNumber' ? d.poUrl
                    : col.id === 'allocatedPO' ? d.allocatedPOUrl
                    : col.id === 'lotNumber' ? d.lotUrl
                    : undefined) as string | undefined
                  : undefined;
                return (
                  <td key={col.id} style={CELL_STYLE(false)}>
                    {col.link && linkUrl && text !== '—' ? (
                      <a
                        href={linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#1A3D63', fontWeight: 400, fontSize: 11, textDecoration: 'none', cursor: 'pointer' }}
                        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                      >
                        {text}
                      </a>
                    ) : (
                      <span style={{ color: '#3D5166', fontSize: 11 }}>{text}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
      {qtyCol && (
        <tfoot>
          <tr style={{ background: '#F1F5FA' }}>
            {effectiveCols.map((col, idx) => (
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
                {idx === 0 ? (
                  <span style={{ color: '#0D1F33', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 13 }}>
                    TOTAL - {visibleRows.length} TRANSACTION{visibleRows.length !== 1 ? 'S' : ''}
                  </span>
                ) : col.isQty ? (
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: isMBF && !canConvert ? '#7A8FA3' : meta.color, fontSize: 13 }}>
                    {isMBF && !canConvert
                      ? 'N/A'
                      : isMBF
                        ? (Math.round(totalQty * 10) / 10).toLocaleString(undefined, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })
                        : Math.round(totalQty).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                ) : null}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
};

// ── DetailDrawerMTL ──────────────────────────────────────────────────────────

export const DetailDrawerMTL = ({
  open,
  onOpenChange,
  type,
  row,
  uom,
  subsidiaryId,
  resetCacheVersion,
}: DetailDrawerMTLProps) => {
  // All hooks must be called before any conditional return
  const { data, loading, error, fetchDetail } = useDetailData({ resetCacheVersion });
  const [activeTab, setActiveTab] = React.useState<string>(type ?? 'onHand');

  const mbfFactor = row?.mbfFactor ?? 0;
  const isMBF = uom === 'MBF';

  React.useEffect(() => {
    if (!row || !open) return;
    fetchDetail(row.internalId, row.locationId, undefined, subsidiaryId).catch(() => {});
  }, [open, row?.internalId, row?.locationId, fetchDetail, subsidiaryId]);

  React.useEffect(() => {
    if (open && type) setActiveTab(type);
  }, [open, type]);

  const headerTotal = React.useMemo(() => {
    if (!row) return 0;
    // Available tab: compute from raw buckets (same source as footer)
    if (activeTab === 'available' && data) {
      const grouped = buildPOGroups(data);
      const raw = grouped.totalNetAvailable;
      const factor = row.mbfFactor ?? 0;
      if (isMBF && factor > 0) return Math.round(raw * factor * 100) / 100;
      return raw;
    }
    if (activeTab === 'available') {
      const raw = (row.available as number) || 0;
      const factor = row.mbfFactor ?? 0;
      if (isMBF && factor > 0) return Math.round(raw * factor * 100) / 100;
      return raw;
    }
    const tabData = data?.[activeTab as keyof typeof data] as Record<string, unknown>[] | undefined;
    const qtyCol = COLUMN_MAP_MTL[activeTab]?.find((c) => c.isQty);
    if (!qtyCol) return 0;
    let raw: number;
    if (!tabData?.length) {
      raw = (row[activeTab as keyof SummaryRow] as number) || 0;
    } else {
      raw = tabData.reduce((sum, r) => sum + (Number(r[qtyCol.id]) || 0), 0);
    }
    const factor = row.mbfFactor ?? 0;
    if (isMBF && factor > 0) return Math.round(raw * factor * 100) / 100;
    return raw;
  }, [data, activeTab, row, isMBF]);

  // Null guard — after all hooks
  if (!row) return null;

  const meta = MODAL_META_MTL[activeTab] ?? MODAL_META_MTL.onHand;
  // Line 1: itemCode · location · grade (matching IND)
  const headerLine1 = [
    row.itemCode,
    row.locationName,
    row.grade ? `Grade ${row.grade}` : '',
  ].filter(Boolean).join(' · ');
  // Line 2: description (matching IND)
  const descParts: string[] = [];
  if (row.species) descParts.push(row.species);
  if (row.thickness) descParts.push(row.thickness);
  if (row.width) descParts.push('x' + row.width);
  if (row.length) descParts.push(row.length);
  if (row.grade) descParts.push(row.grade);
  const headerLine2 = descParts.join(' ') || row.itemName || '';

  const rawTabData = data?.[activeTab as keyof typeof data] as Record<string, unknown>[] | undefined;
  // On Hand: show PO# (or Inv. Adj. #) in Document # instead of IR#
  const tabData = React.useMemo(() => {
    if (activeTab !== 'onHand' || !rawTabData) return rawTabData;
    return rawTabData.map((r) => ({
      ...r,
      docNumber: r.poNumber || r.docNumber,
      docUrl: r.poUrl || r.docUrl,
    }));
  }, [rawTabData, activeTab]);

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
              {headerLine1 && (
                <div className="text-white/55 text-xs font-mono mt-0.5">
                  {headerLine1}
                </div>
              )}
              {headerLine2 && (
                <div className="text-white/70 text-[11px] mt-0.5">
                  {headerLine2}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-white/45 text-[10px] uppercase tracking-wider">
                {isMBF ? 'Total MBF' : 'Total Packs'}
              </div>
              <div className="font-mono text-[16px] font-bold" style={{ color: meta.bg }}>
                {isMBF && mbfFactor === 0
                  ? 'N/A'
                  : isMBF
                    ? (Math.round(headerTotal * 10) / 10).toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })
                    : Math.round(headerTotal).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
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
            className="grid w-full grid-cols-6 flex-shrink-0 rounded-lg overflow-hidden"
            style={{ background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 100%)' }}
          >
            {(['onHand', 'committed', 'outbound', 'onOrder', 'inTransit', 'available'] as const).map((t) => {
              const isActive = activeTab === t;
              const tabMeta = MODAL_META_MTL[t];
              const label = TAB_LABELS_MTL[t];
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
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = '#fff';
                      e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex-1 overflow-auto">
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : error ? (
              <p className="text-destructive">{error}</p>
            ) : activeTab === 'available' && data ? (
              <AvailableTabMTL data={data} uom={uom} mbfFactor={mbfFactor} />
            ) : tabData?.length ? (
              <DetailTableMTL
                rows={tabData}
                columns={COLUMN_MAP_MTL[activeTab] ?? []}
                meta={meta}
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
