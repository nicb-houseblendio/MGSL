/**
 * Open Sales Orders — the trader screen's second tab.
 *
 * Follows the client prototype: orders grouped by the trader who sold them, each
 * group with a subtotal, and header totals across everything visible. A row
 * expands to its line items.
 *
 * Two behaviours are taken straight from the prototype because they encode rules
 * the client stated rather than styling choices:
 *
 *  - Edit is offered on Reserved and In Transit orders but NOT on Ready to Build.
 *    "Une fois qu'il est ready to build... on peut plus edit" — the warehouse has
 *    started preparing it, so the trader can no longer change the lines.
 *  - Lines carry their own status. ⚠️ Marc-Antoine answered on 2026-08-13 that
 *    Ready to Build is a HEADER status, which conflicts with both this prototype
 *    and his own diagram's note that "sometimes we have some lines on the SO ready
 *    to build, but not the full order". We render the prototype so he has
 *    something concrete to react to; the contradiction is open with him.
 *
 * ⚠️ DEMO DATA, and read-only. Real orders come from a saved search that does not
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

const orderBF = (o: ArchOpenOrder) => o.lines.reduce((s, l) => s + l.bf, 0);
const orderRevenue = (o: ArchOpenOrder) => o.lines.reduce((s, l) => s + lineRevenue(l), 0);
const orderProfit = (o: ArchOpenOrder) => o.lines.reduce((s, l) => s + lineProfit(l), 0);

/** "CWP Prevost +2" — the prototype's compact multi-location label. */
const locationLabel = (o: ArchOpenOrder): string => {
  const distinct = [...new Set(o.lines.map((l) => l.locationName).filter(Boolean))];
  if (distinct.length === 0) return '—';
  return distinct.length === 1 ? distinct[0] : `${distinct[0]} +${distinct.length - 1}`;
};

const money = (n: number, currency: string) =>
  `$${Math.round(n).toLocaleString('en-US')} ${currency}`;

const shipWeek = (iso: string) => {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const STATUS_STYLE: Record<ArchOrderStatus, { bg: string; fg: string }> = {
  Reserved: { bg: '#FEF3C7', fg: '#A16207' },
  'Ready to Build': { bg: '#CCFBF1', fg: '#0F766E' },
  'In Transit': { bg: '#F3E8FF', fg: '#7E22CE' },
};

const StatusPill = ({ status }: { status: ArchOrderStatus }) => {
  const s = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 9px',
        borderRadius: 6,
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

/* ── Shared cell styles ─────────────────────────────────────────────────────*/

const th: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#7A8FA3',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  color: ARCH_SURFACE.text,
  verticalAlign: 'middle',
};

export const ArchOpenOrdersView = () => {
  const orders = React.useMemo(() => getOpenOrders(), []);
  const traderColors = React.useMemo(() => traderColorMap(TRADERS), []);

  const [traderFilter, setTraderFilter] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const visible = React.useMemo(
    () => (traderFilter ? orders.filter((o) => o.trader === traderFilter) : orders),
    [orders, traderFilter]
  );

  /** Groups in roster order, so the list doesn't reshuffle as data changes. */
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

  // Totals are over what is VISIBLE, so filtering by trader retotals rather than
  // showing a figure that doesn't match the rows underneath it.
  const totalBF = visible.reduce((s, o) => s + orderBF(o), 0);
  const totalSales = visible.reduce((s, o) => s + orderRevenue(o), 0);
  const totalProfit = visible.reduce((s, o) => s + orderProfit(o), 0);

  return (
    // A LIGHT surface, deliberately, on both themes — the same decision the ARCH
    // detail modal already makes. Without it the header sat directly on the app's
    // background: in dark OS mode that is navy, and this view's dark text vanished
    // while the white group cards below stayed readable, so half the tab was
    // invisible.
    <div
      style={{
        padding: '4px 16px 20px',
        margin: '0 4px 4px',
        borderRadius: 10,
        background: '#EEF1F6',
        color: ARCH_SURFACE.text,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, padding: '12px 4px 14px' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Open Sales Orders</div>
          <div style={{ fontSize: 11, color: ARCH_SURFACE.textLight, marginTop: 1 }}>
            {visible.length} open order{visible.length === 1 ? '' : 's'}
          </div>
        </div>

        <div>
          <label
            style={{
              display: 'block',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: ARCH_SURFACE.textLight,
              marginBottom: 3,
            }}
          >
            Trader
          </label>
          <select
            value={traderFilter}
            onChange={(e) => setTraderFilter(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #CBD5E1',
              background: '#fff',
              color: ARCH_SURFACE.text,
              fontSize: 12,
              fontFamily: 'inherit',
              minWidth: 170,
            }}
          >
            <option value="">All traders</option>
            {TRADERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={toggleAll}
          disabled={visible.length === 0}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: '1px solid #CBD5E1',
            background: '#fff',
            color: ARCH_SURFACE.textMid,
            fontSize: 12,
            fontWeight: 600,
            cursor: visible.length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {allExpanded ? '▾ Collapse all' : '▸ Expand all'}
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 26, textAlign: 'right' }}>
          {[
            { label: 'Total BF', value: formatBF(totalBF) },
            { label: 'Sales', value: money(totalSales, 'USD') },
            { label: 'Est. profit', value: money(totalProfit, 'USD') },
          ].map((s) => (
            <div key={s.label}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: ARCH_SURFACE.textLight,
                }}
              >
                {s.label}
              </div>
              <div className="font-mono" style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div
          style={{
            background: '#fff',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            padding: '40px 0',
            textAlign: 'center',
            color: ARCH_SURFACE.textLight,
            fontSize: 12.5,
          }}
        >
          No open orders for this trader.
        </div>
      ) : (
        groups.map(([trader, list]) => {
          const subBF = list.reduce((s, o) => s + orderBF(o), 0);
          const subItems = list.reduce((s, o) => s + o.lines.length, 0);
          const subSales = list.reduce((s, o) => s + orderRevenue(o), 0);
          const subProfit = list.reduce((s, o) => s + orderProfit(o), 0);

          return (
            <div
              key={trader}
              style={{
                marginBottom: 18,
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid #E2E8F0',
                background: '#fff',
              }}
            >
              {/* Trader band */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 14px',
                  background: 'linear-gradient(135deg,#0F2641,#1A3D63)',
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: traderColors[trader] || '#64748B',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {traderInitials(trader)}
                </span>
                <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{trader}</span>
                <span style={{ color: '#AFC2D6', fontSize: 11 }}>
                  · {list.length} open order{list.length === 1 ? '' : 's'}
                </span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <th style={{ ...th, width: 26 }} />
                    <th style={{ ...th, textAlign: 'left' }}>SO #</th>
                    <th style={{ ...th, textAlign: 'left' }}>Status</th>
                    <th style={{ ...th, textAlign: 'left' }}>Customer</th>
                    <th style={{ ...th, textAlign: 'left' }}>Location</th>
                    <th style={{ ...th, textAlign: 'left' }}>Ship week</th>
                    <th style={{ ...th, textAlign: 'right' }}>Total BF</th>
                    <th style={{ ...th, textAlign: 'right' }}>Items</th>
                    <th style={{ ...th, textAlign: 'right' }}>Sales amount</th>
                    <th style={{ ...th, textAlign: 'right' }}>Est. profit</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((o, i) => {
                    const isOpen = !!expanded[o.soNo];
                    // "Une fois qu'il est ready to build... on peut plus edit."
                    const editable = o.status !== 'Ready to Build';
                    return (
                      <React.Fragment key={o.soNo}>
                        <tr
                          style={{
                            background: isOpen ? '#F0F5FF' : i % 2 ? '#FBFCFE' : '#fff',
                            borderBottom: '1px solid #EEF1F6',
                          }}
                        >
                          <td style={{ ...td, textAlign: 'center', padding: '8px 4px' }}>
                            <button
                              type="button"
                              onClick={() => setExpanded((e) => ({ ...e, [o.soNo]: !e[o.soNo] }))}
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${o.soNo}`}
                              style={{
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                color: ARCH_SURFACE.textMid,
                                fontSize: 10,
                                padding: 2,
                              }}
                            >
                              {isOpen ? '▾' : '▸'}
                            </button>
                          </td>
                          <td style={td}>
                            <span
                              className="font-mono"
                              style={{ fontWeight: 700, color: '#1A6FE0', fontSize: 11.5 }}
                            >
                              {o.soNo}
                            </span>
                            {editable && (
                              <span
                                title="Editing does nothing yet — orders are demo data"
                                style={{
                                  marginLeft: 7,
                                  padding: '1px 7px',
                                  borderRadius: 5,
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  background: '#FEF3C7',
                                  color: '#A16207',
                                }}
                              >
                                ✎ Edit
                              </span>
                            )}
                          </td>
                          <td style={td}>
                            <StatusPill status={o.status} />
                          </td>
                          <td style={{ ...td, fontWeight: 600 }}>{o.customer}</td>
                          <td style={{ ...td, color: ARCH_SURFACE.textMid }}>{locationLabel(o)}</td>
                          <td style={{ ...td, color: ARCH_SURFACE.textMid }}>{shipWeek(o.shipDate)}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                            {formatBF(orderBF(o))}
                          </td>
                          <td style={{ ...td, textAlign: 'right' }} className="font-mono">
                            {o.lines.length}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                            {money(orderRevenue(o), o.currency)}
                          </td>
                          <td
                            style={{ ...td, textAlign: 'right', fontWeight: 700, color: ARCH_SURFACE.green }}
                            className="font-mono"
                          >
                            {money(orderProfit(o), o.currency)}
                          </td>
                        </tr>

                        {isOpen && (
                          <tr style={{ background: '#F8FAFC' }}>
                            <td />
                            <td colSpan={9} style={{ padding: '4px 10px 12px' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr>
                                    <th style={{ ...th, textAlign: 'left' }}>Line items</th>
                                    <th style={{ ...th, textAlign: 'left' }}>Status</th>
                                    <th style={{ ...th, textAlign: 'left' }}>Location</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Total BF</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Sales amount</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Est. profit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.lines.map((l) => (
                                    <tr key={l.key} style={{ borderTop: '1px solid #EEF1F6' }}>
                                      <td style={{ ...td, padding: '7px 10px' }}>
                                        <span style={{ fontWeight: 600 }}>{l.description}</span>{' '}
                                        <span
                                          className="font-mono"
                                          style={{
                                            fontSize: 10,
                                            color: ARCH_SURFACE.textMid,
                                            background: '#EEF1F6',
                                            padding: '1px 5px',
                                            borderRadius: 4,
                                            marginLeft: 4,
                                          }}
                                        >
                                          {l.lotNo}
                                        </span>{' '}
                                        <span style={{ fontSize: 10.5, color: ARCH_SURFACE.textLight }}>
                                          ${(l.pricePerBF ?? 0).toFixed(2)} {o.currency}/BF
                                        </span>
                                      </td>
                                      <td style={{ ...td, padding: '7px 10px' }}>
                                        {l.lineStatus && <StatusPill status={l.lineStatus} />}
                                      </td>
                                      <td style={{ ...td, padding: '7px 10px', color: ARCH_SURFACE.textMid }}>
                                        {l.locationName}
                                      </td>
                                      <td
                                        style={{ ...td, padding: '7px 10px', textAlign: 'right' }}
                                        className="font-mono"
                                      >
                                        {formatBF(l.bf)}
                                      </td>
                                      <td
                                        style={{ ...td, padding: '7px 10px', textAlign: 'right' }}
                                        className="font-mono"
                                      >
                                        {money(lineRevenue(l), o.currency)}
                                      </td>
                                      <td
                                        style={{
                                          ...td,
                                          padding: '7px 10px',
                                          textAlign: 'right',
                                          color: ARCH_SURFACE.green,
                                        }}
                                        className="font-mono"
                                      >
                                        {money(lineProfit(l), o.currency)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Subtotal */}
                  <tr style={{ background: '#F1F5F9', borderTop: '2px solid #E2E8F0' }}>
                    <td />
                    <td
                      colSpan={5}
                      style={{
                        ...td,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: ARCH_SURFACE.textMid,
                      }}
                    >
                      Subtotal — {trader}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                      {formatBF(subBF)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                      {subItems}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                      {money(subSales, 'USD')}
                    </td>
                    <td
                      style={{ ...td, textAlign: 'right', fontWeight: 700, color: ARCH_SURFACE.green }}
                      className="font-mono"
                    >
                      {money(subProfit, 'USD')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
};
