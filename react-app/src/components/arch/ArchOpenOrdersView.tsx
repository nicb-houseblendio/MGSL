/**
 * Open Sales Orders — the trader screen's second tab.
 *
 * Orders grouped by the trader who sold them, each group with a subtotal, header
 * totals across whatever is visible, and rows that expand to their line items.
 *
 * ONE TABLE, with a single `<colgroup>`. The first version rendered a separate
 * table per trader, which let every group auto-size its own columns: STATUS
 * landed at a different x in each group and the eye could not scan down a column.
 * Column widths are declared once here and every row — order, line item, subtotal
 * — sits on the same grid. Line-item rows deliberately reuse the parent columns
 * (status under Status, BF under Total BF) rather than nesting a second table,
 * so a figure and its breakdown share a vertical axis.
 *
 * Two behaviours come from the client prototype because they encode stated rules:
 *
 *  - Edit is offered on Reserved and In Transit but NOT on Ready to Build.
 *    "Une fois qu'il est ready to build... on peut plus edit."
 *  - Lines carry their own status. ⚠️ Marc-Antoine answered on 2026-08-13 that
 *    Ready to Build is a HEADER status, which conflicts with both this prototype
 *    and his diagram's note that "sometimes we have some lines on the SO ready to
 *    build, but not the full order". We render the prototype so he has something
 *    concrete to react to; the contradiction is open with him.
 *
 * ⚠️ DEMO DATA, read-only. Real orders come from a saved search that does not
 * exist yet, and Edit does nothing.
 */

import * as React from 'react';
import { formatBF } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import { traderInitials, traderColorMap } from '@/lib/archTraders';
import { getOpenOrders, TRADERS } from '@/lib/archOrderFixtures';
import type { ArchCartLine, ArchOpenOrder, ArchOrderStatus } from '@/types/archOrder';

/* ── Derived figures ────────────────────────────────────────────────────────*/

const lineRevenue = (l: ArchCartLine) => l.bf * (l.pricePerBF ?? 0);
const lineProfit = (l: ArchCartLine) => l.bf * ((l.pricePerBF ?? 0) - l.costPerBF);
const lineMargin = (l: ArchCartLine) => {
  const r = lineRevenue(l);
  return r > 0 ? lineProfit(l) / r : 0;
};

const orderBF = (o: ArchOpenOrder) => o.lines.reduce((s, l) => s + l.bf, 0);
const orderRevenue = (o: ArchOpenOrder) => o.lines.reduce((s, l) => s + lineRevenue(l), 0);
const orderProfit = (o: ArchOpenOrder) => o.lines.reduce((s, l) => s + lineProfit(l), 0);
const orderMargin = (o: ArchOpenOrder) => {
  const r = orderRevenue(o);
  return r > 0 ? orderProfit(o) / r : 0;
};

/** "CWP Prevost +2" — compact when an order spans several locations. */
const locationLabel = (o: ArchOpenOrder): string => {
  const distinct = [...new Set(o.lines.map((l) => l.locationName).filter(Boolean))];
  if (distinct.length === 0) return '—';
  return distinct.length === 1 ? distinct[0] : `${distinct[0]} +${distinct.length - 1}`;
};

const shipWeek = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

/**
 * Money, with the amount dominant and the currency code recessed.
 *
 * The code has to stay per row — orders are a mix of USD and CAD — but at full
 * weight it competed with the figure on all 24 rows. It is dimmed instead.
 */
const Money = ({ n, currency }: { n: number; currency: string }) => (
  <>
    ${Math.round(n).toLocaleString('en-US')}
    <span style={{ color: ARCH_SURFACE.textLight, fontSize: '0.82em', marginLeft: 3 }}>{currency}</span>
  </>
);

/**
 * Margin is only coloured when it is worth reacting to.
 *
 * Everything was green before, which is decoration rather than information: if
 * every number is green, green stops meaning anything.
 */
const profitColor = (margin: number) =>
  margin < 0 ? '#B91C1C' : margin < 0.08 ? '#A16207' : ARCH_SURFACE.text;

const STATUS_STYLE: Record<ArchOrderStatus, { bg: string; fg: string }> = {
  Reserved: { bg: '#FEF3C7', fg: '#A16207' },
  'Ready to Build': { bg: '#CCFBF1', fg: '#0F766E' },
  'In Transit': { bg: '#F3E8FF', fg: '#7E22CE' },
};

/** Fixed width so the Status column has a clean right edge across every row. */
const StatusPill = ({ status }: { status: ArchOrderStatus }) => {
  const s = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: 92,
        textAlign: 'center',
        padding: '2px 8px',
        borderRadius: 5,
        fontSize: 10.5,
        fontWeight: 700,
        background: s.bg,
        color: s.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
};

/* ── Cell styles ────────────────────────────────────────────────────────────*/

const PAD_L = 16;

const th: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: ARCH_SURFACE.textLight,
  whiteSpace: 'nowrap',
  background: '#fff',
  borderBottom: '1px solid #E2E8F0',
};

const td: React.CSSProperties = {
  padding: '9px 12px',
  fontSize: 12,
  color: ARCH_SURFACE.text,
  verticalAlign: 'middle',
};

const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };

interface ArchOpenOrdersViewProps {
  /** Open the sales-order builder on this order. */
  onEditOrder?: (soNo: string) => void;
}

export const ArchOpenOrdersView = ({ onEditOrder }: ArchOpenOrdersViewProps) => {
  const orders = React.useMemo(() => getOpenOrders(), []);
  const traderColors = React.useMemo(() => traderColorMap(TRADERS), []);

  const [traderFilter, setTraderFilter] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const visible = React.useMemo(
    () => (traderFilter ? orders.filter((o) => o.trader === traderFilter) : orders),
    [orders, traderFilter]
  );

  const groups = React.useMemo(() => {
    const byTrader = new Map<string, ArchOpenOrder[]>();
    visible.forEach((o) => {
      if (!byTrader.has(o.trader)) byTrader.set(o.trader, []);
      byTrader.get(o.trader)!.push(o);
    });
    return [...byTrader.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const allExpanded = visible.length > 0 && visible.every((o) => expanded[o.soNo]);
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    if (!allExpanded) visible.forEach((o) => { next[o.soNo] = true; });
    setExpanded(next);
  };

  // Totals track what is VISIBLE, so filtering by trader retotals rather than
  // showing a figure that does not match the rows beneath it.
  const totalBF = visible.reduce((s, o) => s + orderBF(o), 0);
  const totalSales = visible.reduce((s, o) => s + orderRevenue(o), 0);
  const totalProfit = visible.reduce((s, o) => s + orderProfit(o), 0);

  const control: React.CSSProperties = {
    height: 32,
    padding: '0 11px',
    borderRadius: 7,
    border: '1px solid #CBD5E1',
    background: '#fff',
    color: ARCH_SURFACE.text,
    fontSize: 12.5,
    fontFamily: 'inherit',
  };

  return (
    // A LIGHT surface on both themes, the same decision the ARCH detail modal
    // makes. Without it the header sat on the app background, which is navy in
    // dark mode, and this view's dark text vanished.
    <div style={{ margin: '0 4px 4px', borderRadius: 10, background: '#EEF1F6', color: ARCH_SURFACE.text }}>
      {/*
        ONE content-width container for the header AND the table.
        Capping only the table left it centred at 1500 under a header that spanned
        the full 2520px surface — the mismatch read as a layout bug. Ten dense
        columns stretched across a 2560px monitor is also a very long saccade from
        SO # to Est. profit, so the cap itself is right; it just has to apply to
        the whole view.
      */}
      <div style={{ maxWidth: 1680, margin: '0 auto' }}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: `14px ${PAD_L}px 13px`,
        }}
      >
        <div style={{ marginRight: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.15 }}>
            Open Sales Orders
          </div>
          <div style={{ fontSize: 11.5, color: ARCH_SURFACE.textMid, marginTop: 2 }}>
            {visible.length} open order{visible.length === 1 ? '' : 's'}
            {traderFilter && <span style={{ color: ARCH_SURFACE.textLight }}> · filtered</span>}
          </div>
        </div>

        <select
          value={traderFilter}
          onChange={(e) => setTraderFilter(e.target.value)}
          aria-label="Filter by trader"
          style={{ ...control, minWidth: 168 }}
        >
          <option value="">All traders</option>
          {TRADERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={toggleAll}
          disabled={visible.length === 0}
          style={{
            ...control,
            fontWeight: 600,
            color: ARCH_SURFACE.textMid,
            cursor: visible.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'stretch', gap: 0 }}>
          {[
            { label: 'Total BF', value: formatBF(totalBF), mono: true },
            { label: 'Sales', value: `$${Math.round(totalSales).toLocaleString('en-US')}`, mono: true },
            { label: 'Est. profit', value: `$${Math.round(totalProfit).toLocaleString('en-US')}`, mono: true },
          ].map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: '0 18px',
                textAlign: 'right',
                borderLeft: i === 0 ? 'none' : '1px solid #D8DFE8',
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: ARCH_SURFACE.textLight,
                }}
              >
                {s.label}
              </div>
              <div
                className={s.mono ? 'font-mono' : undefined}
                style={{ fontSize: 19, fontWeight: 700, marginTop: 3, letterSpacing: '-0.02em' }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── One table for everything ──────────────────────────────────────── */}
      <div style={{ padding: `0 ${PAD_L}px 18px` }}>
        <div
          style={{
            background: '#fff',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            {/* Declared once, so every group sits on the same grid. */}
            {/* Customer and Location are BOTH unsized, so they split the slack
                evenly. Sizing only Customer made it absorb every spare pixel and
                left a void in the middle of every row on a wide screen. */}
            <colgroup>
              <col style={{ width: 34 }} />
              <col style={{ width: 158 }} />
              <col style={{ width: 118 }} />
              <col />
              <col />
              <col style={{ width: 92 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 58 }} />
              <col style={{ width: 142 }} />
              <col style={{ width: 134 }} />
            </colgroup>

            <thead>
              <tr>
                <th style={{ ...th, paddingLeft: 14 }} />
                <th style={{ ...th, textAlign: 'left' }}>SO #</th>
                <th style={{ ...th, textAlign: 'left' }}>Status</th>
                <th style={{ ...th, textAlign: 'left' }}>Customer</th>
                <th style={{ ...th, textAlign: 'left' }}>Location</th>
                <th style={{ ...th, textAlign: 'left' }}>Ship week</th>
                <th style={{ ...th, textAlign: 'right' }}>Total BF</th>
                <th style={{ ...th, textAlign: 'right' }}>Items</th>
                <th style={{ ...th, textAlign: 'right' }}>Sales</th>
                <th style={{ ...th, textAlign: 'right', paddingRight: 14 }}>Est. profit</th>
              </tr>
            </thead>

            {groups.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={10} style={{ padding: '44px 0', textAlign: 'center', color: ARCH_SURFACE.textLight, fontSize: 12.5 }}>
                    No open orders for this trader.
                  </td>
                </tr>
              </tbody>
            ) : (
              groups.map(([trader, list]) => {
                const subBF = list.reduce((s, o) => s + orderBF(o), 0);
                const subItems = list.reduce((s, o) => s + o.lines.length, 0);
                const subSales = list.reduce((s, o) => s + orderRevenue(o), 0);
                const subProfit = list.reduce((s, o) => s + orderProfit(o), 0);

                return (
                  <tbody key={trader}>
                    {/* Trader band */}
                    <tr>
                      <td colSpan={10} style={{ padding: 0 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 9,
                            padding: '8px 14px',
                            background: 'linear-gradient(135deg,#0F2641,#1A3D63)',
                          }}
                        >
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: traderColors[trader] || '#64748B',
                              color: '#fff',
                              fontSize: 8.5,
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {traderInitials(trader)}
                          </span>
                          <span style={{ color: '#fff', fontSize: 12.5, fontWeight: 700 }}>{trader}</span>
                          <span style={{ color: '#93A9C0', fontSize: 11 }}>
                            {list.length} open order{list.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {list.map((o, i) => {
                      const isOpen = !!expanded[o.soNo];
                      // "Une fois qu'il est ready to build... on peut plus edit."
                      const editable = o.status !== 'Ready to Build';
                      return (
                        <React.Fragment key={o.soNo}>
                          <tr
                            style={{
                              background: isOpen ? '#F2F6FD' : i % 2 ? '#FBFCFE' : '#fff',
                              borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                            }}
                          >
                            <td style={{ ...td, padding: '9px 0 9px 10px' }}>
                              <button
                                type="button"
                                onClick={() => setExpanded((e) => ({ ...e, [o.soNo]: !e[o.soNo] }))}
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${o.soNo}`}
                                style={{
                                  width: 22,
                                  height: 22,
                                  border: 'none',
                                  borderRadius: 5,
                                  background: isOpen ? '#DCE7F8' : 'transparent',
                                  cursor: 'pointer',
                                  color: isOpen ? ARCH_SURFACE.navyMid : ARCH_SURFACE.textLight,
                                  fontSize: 11,
                                  lineHeight: 1,
                                }}
                              >
                                {isOpen ? '▾' : '▸'}
                              </button>
                            </td>
                            <td style={td}>
                              {/* The SO number was styled like a link but did
                                  nothing. It cannot open a NetSuite record —
                                  these are fixtures — so it toggles the row,
                                  which is what a trader expects from clicking an
                                  order anyway. */}
                              <button
                                type="button"
                                onClick={() => setExpanded((e) => ({ ...e, [o.soNo]: !e[o.soNo] }))}
                                className="font-mono"
                                title={isOpen ? 'Hide line items' : 'Show line items'}
                                style={{
                                  border: 'none',
                                  background: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  fontWeight: 700,
                                  color: '#1A6FE0',
                                  fontSize: 11.5,
                                  fontFamily: 'inherit',
                                }}
                              >
                                {o.soNo}
                              </button>
                              {editable && (
                                <button
                                  type="button"
                                  onClick={() => onEditOrder?.(o.soNo)}
                                  title={`Add items to ${o.soNo}`}
                                  style={{
                                    marginLeft: 6,
                                    padding: '2px 7px',
                                    borderRadius: 4,
                                    border: '1px solid #D8DFE8',
                                    fontSize: 9.5,
                                    fontWeight: 700,
                                    background: '#fff',
                                    color: ARCH_SURFACE.textMid,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    verticalAlign: '1px',
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                            <td style={td}>
                              <StatusPill status={o.status} />
                            </td>
                            <td style={{ ...td, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {o.customer}
                            </td>
                            <td style={{ ...td, color: ARCH_SURFACE.textMid, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {locationLabel(o)}
                            </td>
                            <td style={{ ...td, color: ARCH_SURFACE.textMid, whiteSpace: 'nowrap' }}>
                              {shipWeek(o.shipDate)}
                            </td>
                            <td style={{ ...num, fontWeight: 700 }} className="font-mono">
                              {formatBF(orderBF(o))}
                            </td>
                            <td style={{ ...num, color: ARCH_SURFACE.textMid }} className="font-mono">
                              {o.lines.length}
                            </td>
                            <td style={{ ...num, fontWeight: 700 }} className="font-mono">
                              <Money n={orderRevenue(o)} currency={o.currency} />
                            </td>
                            <td
                              style={{ ...num, fontWeight: 700, paddingRight: 14, color: profitColor(orderMargin(o)) }}
                              className="font-mono"
                            >
                              <Money n={orderProfit(o)} currency={o.currency} />
                            </td>
                          </tr>

                          {/* Line items reuse the SAME columns — status under Status,
                              BF under Total BF — so a figure and its breakdown share
                              a vertical axis. */}
                          {isOpen &&
                            o.lines.map((l, li) => (
                              <tr key={l.key} style={{ background: '#F8FAFC' }}>
                                <td style={{ ...td, padding: 0 }} />
                                <td style={{ ...td, padding: '6px 12px 6px 24px' }}>
                                  <span
                                    className="font-mono"
                                    style={{ fontSize: 10, color: ARCH_SURFACE.textMid }}
                                    title={l.lotNo}
                                  >
                                    {l.lotNo}
                                  </span>
                                </td>
                                <td style={{ ...td, padding: '6px 12px' }}>
                                  {l.lineStatus && <StatusPill status={l.lineStatus} />}
                                </td>
                                <td
                                  style={{
                                    ...td,
                                    padding: '6px 12px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={l.description}
                                >
                                  {l.description}
                                </td>
                                <td
                                  style={{
                                    ...td,
                                    padding: '6px 12px',
                                    color: ARCH_SURFACE.textMid,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {l.locationName}
                                </td>
                                <td
                                  style={{ ...td, padding: '6px 12px', color: ARCH_SURFACE.textLight, whiteSpace: 'nowrap' }}
                                  className="font-mono"
                                >
                                  ${(l.pricePerBF ?? 0).toFixed(2)}/BF
                                </td>
                                <td style={{ ...num, padding: '6px 12px' }} className="font-mono">
                                  {formatBF(l.bf)}
                                </td>
                                <td style={{ ...num, padding: '6px 12px' }} />
                                <td style={{ ...num, padding: '6px 12px' }} className="font-mono">
                                  <Money n={lineRevenue(l)} currency={o.currency} />
                                </td>
                                <td
                                  style={{
                                    ...num,
                                    padding: '6px 12px 6px 12px',
                                    paddingRight: 14,
                                    color: profitColor(lineMargin(l)),
                                  }}
                                  className="font-mono"
                                >
                                  <Money n={lineProfit(l)} currency={o.currency} />
                                </td>
                                {li === o.lines.length - 1 && null}
                              </tr>
                            ))}
                        </React.Fragment>
                      );
                    })}

                    {/* Subtotal: reads as a summary, not another data row. */}
                    <tr style={{ background: '#EFF3F8', borderTop: '1.5px solid #D8DFE8' }}>
                      <td style={{ ...td, padding: '8px 0 8px 14px' }} />
                      <td
                        colSpan={5}
                        style={{
                          ...td,
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: ARCH_SURFACE.textMid,
                        }}
                      >
                        Subtotal · {trader}
                      </td>
                      <td style={{ ...num, fontWeight: 700 }} className="font-mono">
                        {formatBF(subBF)}
                      </td>
                      <td style={{ ...num, color: ARCH_SURFACE.textMid }} className="font-mono">
                        {subItems}
                      </td>
                      <td style={{ ...num, fontWeight: 700 }} className="font-mono">
                        <Money n={subSales} currency="USD" />
                      </td>
                      <td style={{ ...num, fontWeight: 700, paddingRight: 14 }} className="font-mono">
                        <Money n={subProfit} currency="USD" />
                      </td>
                    </tr>
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </div>
      </div>
    </div>
  );
};
