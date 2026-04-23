import * as React from 'react';
import type { DetailPayload } from '@/hooks/useDetailData';
import { CurrencyBadge } from '@/components/InventoryTableMTL';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AvailRow {
  rowType: 'onHand' | 'onOrder' | 'inTransit' | 'committed' | 'unallocated';
  docType: string;
  docNumber: string;
  docUrl: string;
  poNumber: string;
  poUrl: string;
  date: string;
  vendor: string;
  vendorUrl: string;
  lotNumber: string;
  lotUrl: string;
  allocatedPO: string;
  status: string;
  packsAvail: number;
  piecesPerPack: number;
  mbfPrice: number;
  currency: string;
}

interface POGroup {
  po: string;
  poUrl: string;
  supplyRows: AvailRow[];
  committedRows: AvailRow[];
  supplyTotal: number;
  committedTotal: number;
  netAvailable: number;
}

interface GroupedAvailable {
  poGroups: POGroup[];
  unallocated: AvailRow[];
  totalTransactions: number;
  totalNetAvailable: number;
}

// ── Grouping logic ─────────────────────────────────────────────────────────────

const DASH = '\u2014';
const NO_PO = '__no_po__';

export function buildPOGroups(data: DetailPayload): GroupedAvailable {
  type RawRow = Record<string, unknown>;
  const str = (v: unknown) => (v == null || v === '' ? '' : String(v));
  const num = (v: unknown) => Number(v) || 0;

  const onHand = (data?.onHand ?? []) as RawRow[];
  const committed = (data?.committed ?? []) as RawRow[];
  const onOrder = (data?.onOrder ?? []) as RawRow[];
  const inTransit = (data?.inTransit ?? []) as RawRow[];

  const poMap: Record<string, { supplyRows: AvailRow[]; committedRows: AvailRow[]; poUrl: string }> = {};

  const getOrCreate = (po: string) => {
    const key = po || NO_PO;
    if (!poMap[key]) poMap[key] = { supplyRows: [], committedRows: [], poUrl: '' };
    return poMap[key];
  };

  // On Hand -> group by poNumber
  for (const r of onHand) {
    const po = str(r.poNumber);
    const g = getOrCreate(po);
    if (!g.poUrl && r.poUrl) g.poUrl = str(r.poUrl);
    g.supplyRows.push({
      rowType: 'onHand',
      docType: str(r.docType), docNumber: str(r.docNumber), docUrl: str(r.docUrl),
      poNumber: str(r.poNumber), poUrl: str(r.poUrl),
      date: str(r.date),
      vendor: str(r.vendor), vendorUrl: str(r.vendorUrl),
      lotNumber: str(r.lotNumber), lotUrl: str(r.lotUrl),
      allocatedPO: '',
      status: 'On Hand',
      packsAvail: num(r.packsOnHand),
      piecesPerPack: num(r.piecesPerPack),
      mbfPrice: num(r.mbfPrice),
      currency: str(r.currency),
    });
  }

  // On Order -> group by docNumber (which IS the PO)
  for (const r of onOrder) {
    const po = str(r.docNumber);
    const g = getOrCreate(po);
    if (!g.poUrl && r.docUrl) g.poUrl = str(r.docUrl);
    g.supplyRows.push({
      rowType: 'onOrder',
      docType: '', docNumber: '', docUrl: '',
      poNumber: str(r.docNumber), poUrl: str(r.docUrl),
      date: '',
      vendor: str(r.vendor), vendorUrl: str(r.vendorUrl),
      lotNumber: '', lotUrl: '',
      allocatedPO: '',
      status: 'On Order',
      packsAvail: num(r.packs),
      piecesPerPack: num(r.piecesPerPack),
      mbfPrice: num(r.mbfPrice),
      currency: str(r.currency),
    });
  }

  // In Transit -> group by docNumber
  for (const r of inTransit) {
    const po = str(r.docNumber);
    const g = getOrCreate(po);
    if (!g.poUrl && r.docUrl) g.poUrl = str(r.docUrl);
    g.supplyRows.push({
      rowType: 'inTransit',
      docType: '', docNumber: '', docUrl: '',
      poNumber: str(r.docNumber), poUrl: str(r.docUrl),
      date: '',
      vendor: str(r.vendor), vendorUrl: str(r.vendorUrl),
      lotNumber: '', lotUrl: '',
      allocatedPO: '',
      status: 'In Transit',
      packsAvail: num(r.packs),
      piecesPerPack: num(r.piecesPerPack),
      mbfPrice: num(r.mbfPrice),
      currency: str(r.currency),
    });
  }

  // Committed -> group by allocatedPO
  const unallocated: AvailRow[] = [];
  for (const r of committed) {
    const po = str(r.allocatedPO);
    const rawLot = str(r.lotNumber);
    const lot = rawLot === DASH || rawLot === '\u2014' ? '' : rawLot;
    if (!po || po === DASH || po === '\u2014') {
      unallocated.push({
        rowType: 'unallocated',
        docType: '', docNumber: str(r.docNumber), docUrl: str(r.docUrl),
        poNumber: '', poUrl: '',
        date: '',
        vendor: '', vendorUrl: '',
        lotNumber: lot, lotUrl: str(r.lotUrl),
        allocatedPO: '',
        status: 'Committed',
        packsAvail: -(num(r.packsCommitted)),
        piecesPerPack: num(r.piecesPerPack),
        mbfPrice: num(r.mbfPrice),
        currency: str(r.currency),
      });
    } else {
      const g = getOrCreate(po);
      g.committedRows.push({
        rowType: 'committed',
        docType: '', docNumber: str(r.docNumber), docUrl: str(r.docUrl),
        poNumber: '', poUrl: '',
        date: '',
        vendor: '', vendorUrl: '',
        lotNumber: lot, lotUrl: str(r.lotUrl),
        allocatedPO: po,
        status: 'Committed',
        packsAvail: -(num(r.packsCommitted)),
        piecesPerPack: num(r.piecesPerPack),
        mbfPrice: num(r.mbfPrice),
        currency: str(r.currency),
      });
    }
  }

  // Build sorted groups
  const poGroups: POGroup[] = [];
  for (const [po, g] of Object.entries(poMap)) {
    if (g.supplyRows.length === 0 && g.committedRows.length === 0) continue;
    const supplyTotal = g.supplyRows.reduce((s, r) => s + r.packsAvail, 0);
    const committedTotal = g.committedRows.reduce((s, r) => s + Math.abs(r.packsAvail), 0);
    poGroups.push({
      po: po === NO_PO ? 'No PO' : po,
      poUrl: g.poUrl,
      supplyRows: g.supplyRows,
      committedRows: g.committedRows,
      supplyTotal: Math.round(supplyTotal * 100) / 100,
      committedTotal: Math.round(committedTotal * 100) / 100,
      netAvailable: Math.round((supplyTotal - committedTotal) * 100) / 100,
    });
  }
  poGroups.sort((a, b) => a.po.localeCompare(b.po));

  const totalTransactions = poGroups.reduce((s, g) => s + g.supplyRows.length + g.committedRows.length, 0)
    + unallocated.length;
  const unallocNet = unallocated.reduce((s, r) => s + r.packsAvail, 0);
  const totalNetAvailable = Math.round(
    (poGroups.reduce((s, g) => s + g.netAvailable, 0) + unallocNet) * 100
  ) / 100;

  return { poGroups, unallocated, totalTransactions, totalNetAvailable };
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const cellStyle = (numeric: boolean): React.CSSProperties => ({
  padding: '7px 10px',
  borderBottom: '1px solid #CBD5E1',
  borderRight: '1px solid rgba(226,232,240,0.33)',
  textAlign: numeric ? 'right' : 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

const monoLink: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  color: '#1A3D63',
  fontWeight: 400,
  fontSize: 11,
  textDecoration: 'none',
  cursor: 'pointer',
};

const dashEl = <span style={{ color: '#7A8FA3' }}>{DASH}</span>;

// ── Aging helper (matching DetailDrawerMTL) ────────────────────────────────────

const getAgingInfo = (dateVal: string): { style: React.CSSProperties; text: string } => {
  if (!dateVal) return { style: { color: '#7A8FA3' }, text: DASH };
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return { style: { color: '#7A8FA3' }, text: DASH };
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  const text = `${days}d`;
  if (days > 90) return { style: { color: '#B22222', fontWeight: 600 }, text };
  if (days >= 30) return { style: { color: '#B58A00', fontWeight: 600 }, text };
  return { style: { color: '#7A8FA3' }, text };
};

// ── Status badge colors ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  'On Hand':    { bg: '#EAF3DE', color: '#27500A', border: '#A5D6A7' },
  'On Order':   { bg: '#E8F0FD', color: '#0D47A1', border: '#90CAF9' },
  'In Transit': { bg: '#F0ECF9', color: '#4A148C', border: '#CE93D8' },
  'Committed':  { bg: '#FFF3E0', color: '#E65100', border: '#FFCC80' },
};

const QTY_COLORS: Record<string, string> = {
  'On Hand': '#1B5E20', 'On Order': '#0D47A1', 'In Transit': '#4A148C', 'Committed': '#E65100',
};

// ── Pill styles for section headers ────────────────────────────────────────────

const SUPPLY_PILL: Record<string, { bg: string; color: string; border: string }> = {
  'On Hand':    { bg: '#EAF3DE', color: '#27500A', border: '#A5D6A7' },
  'On Order':   { bg: '#E8F0FD', color: '#0D47A1', border: '#90CAF9' },
  'In Transit': { bg: '#F0ECF9', color: '#4A148C', border: '#CE93D8' },
};

// ── Column definitions ─────────────────────────────────────────────────────────

const COL_COUNT = 10;

interface AvailCol { id: string; label: string; numeric?: boolean }

const AVAIL_COLUMNS: AvailCol[] = [
  { id: 'docNumber',     label: 'Document #' },
  { id: 'date',          label: 'Date' },
  { id: 'aging',         label: 'Aging' },
  { id: 'vendor',        label: 'Vendor' },
  { id: 'lotNumber',     label: 'Lot #' },
  { id: 'status',        label: 'Status' },
  { id: 'packsAvail',    label: 'Packs Available', numeric: true },
  { id: 'piecesPerPack', label: 'Pcs / Pack',      numeric: true },
  { id: 'mbfPrice',      label: 'MBF Price',       numeric: true },
  { id: 'currency',      label: 'Currency' },
];

// ── Cell renderer ──────────────────────────────────────────────────────────────

function renderCell(row: AvailRow, colId: string): React.ReactNode {
  const linkWrap = (url: string, text: string, color?: string) => (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      style={{ ...monoLink, color: color || monoLink.color }}
      onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
      onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
    >{text}</a>
  );

  switch (colId) {
    case 'docNumber': {
      const displayNum = row.poNumber || row.docNumber;
      if (!displayNum) return dashEl;
      const isCommit = row.rowType === 'committed' || row.rowType === 'unallocated';
      const color = isCommit ? '#E65100' : '#1A3D63';
      const url = row.poUrl || row.docUrl;
      return url ? linkWrap(url, displayNum, color)
        : <span style={{ ...monoLink, color, cursor: 'default' }}>{displayNum}</span>;
    }

    case 'date':
      return row.rowType === 'onHand' && row.date
        ? <span style={{ color: '#3D5166', fontSize: 11 }}>{row.date}</span>
        : dashEl;

    case 'aging':
      if (row.rowType !== 'onHand') return dashEl;
      const aging = getAgingInfo(row.date);
      return <span style={{ ...aging.style, fontFamily: 'monospace', fontSize: 11 }}>{aging.text}</span>;

    case 'vendor':
      if (row.rowType === 'committed' || row.rowType === 'unallocated') return dashEl;
      if (!row.vendor) return dashEl;
      return row.vendorUrl
        ? <a href={row.vendorUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: '#3D5166', fontSize: 11, textDecoration: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
            onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
          >{row.vendor}</a>
        : <span style={{ color: '#3D5166', fontSize: 11 }}>{row.vendor}</span>;

    case 'lotNumber':
      if (!row.lotNumber) return dashEl;
      return row.lotUrl ? linkWrap(row.lotUrl, row.lotNumber) : <span style={{ ...monoLink, cursor: 'default' }}>{row.lotNumber}</span>;

    case 'status': {
      const s = STATUS_COLORS[row.status] ?? STATUS_COLORS['Committed'];
      const isDashed = row.rowType === 'unallocated';
      return (
        <span style={{
          background: s.bg, color: s.color,
          border: `1px ${isDashed ? 'dashed' : 'solid'} ${s.border}`,
          padding: '2px 9px', borderRadius: 10, fontSize: 10, fontWeight: 700,
          whiteSpace: 'nowrap', display: 'inline-block',
        }}>{row.status}</span>
      );
    }

    case 'piecesPerPack': {
      const n = Math.round(row.piecesPerPack);
      return <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#7A8FA3' }}>
        {n === 0 ? '0' : n.toLocaleString()}
      </span>;
    }

    case 'mbfPrice':
      if (row.mbfPrice === 0) return dashEl;
      return <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: '#C8A035' }}>
        ${row.mbfPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>;

    case 'currency':
      return row.currency ? <CurrencyBadge currency={row.currency} /> : dashEl;

    default:
      return dashEl;
  }
}

// ── PO Section Header ──────────────────────────────────────────────────────────

const POSectionHeader = ({ group, isMBF, mbfFactor }: { group: POGroup; isMBF: boolean; mbfFactor: number }) => {
  const canConvert = isMBF && mbfFactor > 0;
  const unit = isMBF ? 'MBF' : 'pks';

  const fmtQty = (n: number) => {
    if (canConvert) {
      const v = Math.round(n * mbfFactor * 10) / 10;
      return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    }
    return Math.round(n).toLocaleString();
  };

  // Supply totals by type
  const supplyByType: Record<string, number> = {};
  for (const r of group.supplyRows) supplyByType[r.status] = (supplyByType[r.status] || 0) + r.packsAvail;

  const net = group.netAvailable;
  const netColor = net > 0 ? '#1B5E20' : net < 0 ? '#E65100' : '#B58A00';

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: '#EEF2F8',
      borderLeft: '4px solid #0F2641',
      borderTop: '1px solid #D0DAE8',
      borderBottom: '1px solid #D0DAE8',
      padding: '8px 14px',
      marginTop: 6,
    }}>
      {group.po !== 'No PO' && (
        <span style={{ color: '#7A8FA3', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em', marginRight: 8 }}>PO</span>
      )}
      <span style={{ color: '#0F2641', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700, letterSpacing: '.02em', marginRight: 16 }}>
        {group.po}
      </span>

      {Object.entries(supplyByType).map(([status, total]) => {
        const pill = SUPPLY_PILL[status] || SUPPLY_PILL['On Hand'];
        return (
          <span key={status} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700,
            marginRight: 8, whiteSpace: 'nowrap',
            background: pill.bg, color: pill.color, border: `1px solid ${pill.border}`,
          }}>{status}: {fmtQty(total)} {unit}</span>
        );
      })}

      {group.committedTotal > 0 && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '2px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700,
          marginRight: 8, whiteSpace: 'nowrap',
          background: '#FFF3E0', color: '#C2410C', border: '1px solid #FDBA74',
        }}>Committed: {fmtQty(group.committedTotal)} {unit}</span>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#7A8FA3', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em' }}>Net available</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700, color: netColor }}>
          {net > 0 ? '+' : ''}{fmtQty(net)}
        </span>
      </div>
    </div>
  );
};

// ── Unallocated Section Header ─────────────────────────────────────────────────

const UnallocatedHeader = ({ net, isMBF, mbfFactor }: { net: number; isMBF: boolean; mbfFactor: number }) => {
  const canConvert = isMBF && mbfFactor > 0;
  const displayNet = canConvert
    ? (Math.round(net * mbfFactor * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : Math.round(net).toLocaleString();

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: '#FEF3E2',
      borderLeft: '4px solid #D97706',
      borderTop: '1px solid #FCD9A0',
      borderBottom: '1px solid #FCD9A0',
      padding: '8px 14px',
      marginTop: 6,
    }}>
      <span style={{ fontSize: 14, marginRight: 8 }}>&#9888;&#65039;</span>
      <span style={{ color: '#92400E', fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700 }}>Unallocated</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#7A8FA3', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em' }}>Net available</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700, color: '#E65100' }}>{displayNet}</span>
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

interface AvailableTabMTLProps {
  data: DetailPayload;
  uom: string;
  mbfFactor: number;
}

export const AvailableTabMTL = ({ data, uom, mbfFactor }: AvailableTabMTLProps) => {
  const isMBF = uom === 'MBF';
  const canConvert = isMBF && mbfFactor > 0;

  const grouped = React.useMemo(() => buildPOGroups(data), [data]);

  if (grouped.totalTransactions === 0) {
    return <p style={{ color: '#7A8FA3', padding: '16px' }}>No data</p>;
  }

  const effectiveLabel = isMBF ? 'MBF Available' : 'Packs Available';

  const fmtTotal = (n: number) => {
    if (canConvert) {
      const v = Math.round(n * mbfFactor * 10) / 10;
      return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    }
    return Math.round(n).toLocaleString();
  };

  const footerColor = grouped.totalNetAvailable > 0 ? '#A5D6A7'
    : grouped.totalNetAvailable < 0 ? '#F48FB1' : '#FCD34D';

  // Global row counter for alternating backgrounds
  let rowIdx = 0;

  const renderRow = (row: AvailRow, key: string) => {
    const idx = rowIdx++;
    const rowBg = idx % 2 === 0 ? '#fff' : '#F8FAFC';
    const hoverBg = (row.rowType === 'committed' || row.rowType === 'unallocated') ? '#FFF8F0' : '#F0F7F4';

    // Quantity
    const rawPacks = row.packsAvail;
    const isNeg = rawPacks < 0;
    const absPacks = Math.abs(rawPacks);
    const displayPacks = canConvert ? Math.round(absPacks * mbfFactor * 10) / 10 : Math.round(absPacks);
    const fmtPacks = isMBF && !canConvert ? 'N/A'
      : isMBF ? displayPacks.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : displayPacks.toLocaleString();
    const qtyColor = isNeg ? '#E65100' : (QTY_COLORS[row.status] || '#1B5E20');

    return (
      <tr
        key={key}
        style={{ background: rowBg }}
        onMouseEnter={e => { e.currentTarget.style.background = hoverBg; }}
        onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
      >
        {AVAIL_COLUMNS.map(col => {
          if (col.id === 'packsAvail') {
            return (
              <td key={col.id} style={cellStyle(true)}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: qtyColor }}>
                  {isMBF && !canConvert ? 'N/A' : isNeg ? `(${fmtPacks})` : fmtPacks}
                </span>
              </td>
            );
          }
          return (
            <td key={col.id} style={cellStyle(col.numeric ?? false)}>
              {renderCell(row, col.id)}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, tableLayout: 'auto' }}>
      <thead>
        <tr>
          {AVAIL_COLUMNS.map(col => (
            <th
              key={col.id}
              style={{
                padding: '7px 12px',
                background: '#F8FAFC',
                color: '#7A8FA3',
                fontWeight: 700,
                fontSize: 9,
                textAlign: col.numeric ? 'right' : 'left',
                textTransform: 'uppercase',
                letterSpacing: '.06em',
                borderBottom: '1px solid #CBD5E1',
                whiteSpace: 'nowrap',
                position: 'sticky',
                top: 0,
                zIndex: 2,
              }}
            >
              {col.id === 'packsAvail' ? effectiveLabel : col.label}
            </th>
          ))}
        </tr>
      </thead>

      {grouped.poGroups.map(group => (
        <tbody key={group.po}>
          <tr>
            <td colSpan={COL_COUNT} style={{ padding: 0, borderBottom: 'none' }}>
              <POSectionHeader group={group} isMBF={isMBF} mbfFactor={canConvert ? mbfFactor : 0} />
            </td>
          </tr>
          {group.supplyRows.map((r, i) => renderRow(r, `${group.po}-s-${i}`))}
          {group.committedRows.map((r, i) => renderRow(r, `${group.po}-c-${i}`))}
        </tbody>
      ))}

      {grouped.unallocated.length > 0 && (
        <tbody>
          <tr>
            <td colSpan={COL_COUNT} style={{ padding: 0, borderBottom: 'none' }}>
              <UnallocatedHeader
                net={grouped.unallocated.reduce((s, r) => s + r.packsAvail, 0)}
                isMBF={isMBF}
                mbfFactor={canConvert ? mbfFactor : 0}
              />
            </td>
          </tr>
          {grouped.unallocated.map((r, i) => renderRow(r, `unalloc-${i}`))}
        </tbody>
      )}

      <tfoot>
        <tr style={{ background: 'linear-gradient(to right, #0F2641, #1A3D63)', position: 'sticky', bottom: 0, zIndex: 1, boxShadow: 'inset 0 2px 0 rgba(200,160,53,.4)' }}>
          {AVAIL_COLUMNS.map((col, idx) => (
            <td
              key={col.id}
              style={{
                padding: '10px 14px',
                textAlign: col.numeric ? 'right' : 'left',
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              {idx === 0 ? (
                <span style={{ color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 11, fontWeight: 600 }}>
                  Total {DASH} {grouped.totalTransactions} transaction{grouped.totalTransactions !== 1 ? 's' : ''}
                </span>
              ) : col.id === 'packsAvail' ? (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: footerColor, fontSize: 14, fontWeight: 700 }}>
                  {fmtTotal(grouped.totalNetAvailable)}
                </span>
              ) : null}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
};
