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
 * ⚠️ LIVE, read-only. Orders come from the `openOrders` service action, which reads
 * open hardwood SO lines straight from NetSuite — no saved search involved. Edit
 * opens the wizard in append mode against the real order, which does write.
 *
 * The previous version said "DEMO DATA … a saved search that does not exist yet,
 * and Edit does nothing". All three clauses were false by the time it was read.
 * It still falls back to fixtures with no endpoint, and the banner says which.
 */

import * as React from 'react';
import { formatQty, unitLabel, formatUnitTotals } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import { traderInitials, traderColorMap } from '@/lib/archTraders';
import { TRADERS } from '@/lib/archOrderFixtures';
import { useArchOpenOrders } from '@/hooks/useArchOpenOrders';
import type { ArchLiveOpenOrder } from '@/hooks/useArchOpenOrders';
import type { ArchCartLine, ArchOpenOrder, ArchOrderStatus } from '@/types/archOrder';

/* ── Derived figures ────────────────────────────────────────────────────────*/

/**
 * Revenue: NetSuite's own amount when we have it, derived only when we do not.
 *
 * 🔴 This used to always compute `preSplitQty * pricePerBF`, rebuilding a figure
 * the endpoint had already been given by NetSuite out of two ROUNDED inputs — a
 * price at 6dp and a quantity at 4dp. The drift is fractions of a cent per line
 * and it accumulates into the Sales total, so a tab reporting a customer's order
 * value disagreed with NetSuite for no reason at all.
 *
 * `amount` is absent on a lot picked off the grid, which is not on an order yet
 * and genuinely has no amount — that is the case the fallback is for.
 */
const lineRevenue = (l: ArchCartLine) =>
  l.amount !== undefined ? l.amount : l.preSplitQty * (l.pricePerBF ?? 0);
// `?? 0` on cost is arithmetic-only. A line with unknown cost reports as pure
// profit here, which is why the cost CELL renders an em dash rather than $0.00 —
// the number must never look measured. See ArchOrderTotals.
const lineProfit = (l: ArchCartLine) => lineRevenue(l) - l.preSplitQty * (l.costPerBF ?? 0);
const lineMargin = (l: ArchCartLine) => {
  const r = lineRevenue(l);
  return r > 0 ? lineProfit(l) / r : 0;
};

/**
 * 🔴 A line with no cost is not a line with zero cost.
 *
 * `?? 0` above is arithmetic-only, and with live data it is reachable: a lot that
 * has been sold may no longer be on hand to cost, and the endpoint returns
 * `costPerBF: null` when the cache has no figure for that item and location.
 * Treating that as zero reports the whole of revenue as profit at a 100% margin,
 * which is the most flattering possible lie and looks entirely plausible.
 *
 * With fixtures every line carried a cost, so this never showed. Live data is
 * what makes it reachable, which is why the guard arrives with it.
 */
const costKnown = (l: ArchCartLine) => l.costPerBF !== null && l.costPerBF !== undefined;
const allCostsKnown = (rows: ArchCartLine[]) => rows.every(costKnown);
const UNKNOWN = '—';

/** Quantities of an order grouped by unit — an order may mix Lumber and Veneer. */
const orderQtys = (o: ArchOpenOrder) => o.lines.map((l) => ({ unit: l.unit, qty: l.preSplitQty }));
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

/** Shared shell for the source banner, so its three states cannot drift apart. */
const notice: React.CSSProperties = {
  display: 'flex',
  gap: 9,
  alignItems: 'flex-start',
  margin: '0 0 2px',
  padding: '9px 14px',
  borderRadius: '10px 10px 0 0',
  fontSize: 11.5,
  lineHeight: 1.5,
};

interface ArchOpenOrdersViewProps {
  /** Open the sales-order builder on this order. */
  onEditOrder?: (soNo: string) => void;
}

export const ArchOpenOrdersView = ({ onEditOrder }: ArchOpenOrdersViewProps) => {
  const { orders, source, error, taggedItemCount } = useArchOpenOrders();
  const isDemo = source !== 'netsuite';

  /**
   * Traders that actually appear in the data, not the fixture roster.
   *
   * The filter used to be populated from `TRADERS`, so with live orders it would
   * offer names nobody sold anything under and omit whoever did. TRADERS is still
   * imported for the COLOUR map, where a stable palette across the fixture and
   * live sets is what keeps a trader the same colour between the two.
   */
  const tradersPresent = React.useMemo(
    () => [...new Set(orders.map((o) => o.trader).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [orders]
  );
  const traderColors = React.useMemo(
    () => traderColorMap([...new Set([...TRADERS, ...tradersPresent])]),
    [tradersPresent]
  );

  const [traderFilter, setTraderFilter] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const visible = React.useMemo(
    () => (traderFilter ? orders.filter((o) => o.trader === traderFilter) : orders),
    [orders, traderFilter]
  );

  const groups = React.useMemo(() => {
    const byTrader = new Map<string, ArchLiveOpenOrder[]>();
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
  const totalQtys = visible.flatMap(orderQtys);
  const totalSales = visible.reduce((s, o) => s + orderRevenue(o), 0);
  const totalProfit = visible.reduce((s, o) => s + orderProfit(o), 0);
  /**
   * One uncosted line anywhere in view makes the TOTAL profit unknown, not
   * slightly optimistic. Summing the costed lines and printing the result as
   * "Est. profit" would report a number that is right for a subset and labelled as
   * though it covered everything.
   */
  const totalProfitKnown = visible.every((o) => allCostsKnown(o.lines));

  /**
   * Currencies actually present in what is on screen.
   *
   * Board feet add up across anything. Money does not, and this view summed it
   * as though it did: every money total added order revenue regardless of
   * currency and then labelled the result USD. It is right today only because
   * the fixtures hand every order USD — `currenciesFor(...)[0]` is always the
   * first entry. The customer record already offers CAD, the SO wizard already
   * lets a trader pick it, and the client's own prototype has CAD orders on its
   * Open Sales Orders tab, so the first real CAD order would have produced a
   * wrong number that looked entirely plausible.
   *
   * Rather than invent a conversion rate nobody has agreed, say so: one
   * currency prints normally, more than one is called out instead of silently
   * added together.
   */
  const currenciesPresent = [...new Set(visible.map((o) => o.currency))].sort();
  const mixedCurrency = currenciesPresent.length > 1;
  const soleCurrency = currenciesPresent[0] || 'USD';
  const money = (n: number) =>
    mixedCurrency ? 'Mixed' : `$${Math.round(n).toLocaleString('en-US')}`;

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
        DECLARES ITS SOURCE, in whichever of three states this tab is in.
        Every other ARCH surface does (the grid's Live badge, the split queue's
        `source`); this one used to say so only in code comments, while sitting one
        tab away from genuine live inventory. MGSL are working in this sandbox, so
        invented orders reading as real is a live hazard, not a cosmetic one.

        The third state is the interesting one. Live and EMPTY is the normal case
        today and it is not a quiet day: only a handful of items carry the Hardwood
        segment, and every other CWP order runs on untagged SKUs, so the orders
        exist and this query cannot see them. A blank table would read as "no open
        orders", which is the wrong conclusion to hand somebody.
      */}
      {isDemo ? (
        <div style={{ ...notice, background: '#FFF8E1', borderBottom: '1px solid #E6B800', color: '#7A4100' }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
          <span>
            <strong>Demo data.</strong> These orders are placeholders, not real sales orders —
            the customers, SO numbers and quantities are invented, and none of them can be
            added to. {error || 'The Hardwood tab is live; this one is not connected.'}
          </span>
        </div>
      ) : orders.length === 0 ? (
        <div style={{ ...notice, background: '#EFF6FF', borderBottom: '1px solid #93C5FD', color: '#1E40AF' }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>ℹ️</span>
          <span>
            <strong>Live, and nothing to show.</strong> No open sales order carries a
            hardwood-tagged item.
            {taggedItemCount !== null && (
              <> Only {taggedItemCount} item{taggedItemCount === 1 ? '' : 's'} in the account
                carry the Hardwood segment, so orders on untagged SKUs cannot appear here.</>
            )}{' '}
            Tagging the remaining hardwood items will populate this tab.
          </span>
        </div>
      ) : null}
      {/*
        FULL WIDTH, no content cap. This view was capped at 1680 to keep the
        saccade from SO # to Est. profit short on a 2560px monitor, but Marc-Antoine
        chose full width on 2026-08-13 — "comme les autres TS" — so it now matches
        the Hardwood grid and the Industriel and Métaux screens, which have never
        been capped. Do not reintroduce a max-width here without asking him.
      */}
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
          {tradersPresent.map((t) => (
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
            { label: 'Total qty', value: formatUnitTotals(totalQtys), mono: true },
            {
              label: mixedCurrency ? 'Sales · mixed currency' : `Sales · ${soleCurrency}`,
              value: money(totalSales),
              mono: true,
            },
            {
              label: mixedCurrency ? 'Est. profit · mixed' : `Est. profit · ${soleCurrency}`,
              value: totalProfitKnown ? money(totalProfit) : UNKNOWN,
              mono: true,
            },
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
            {/*
              EVERY column is sized. Under `table-layout: fixed`, a column left
              `auto` takes the ENTIRE surplus before any sized column gets a
              pixel — so with Customer and Location unsized, going full width
              dumped roughly 420px into each and opened two voids mid-row.
              Once all ten carry a width the surplus is shared in proportion,
              which is what the Hardwood grid does (it sizes every column and
              sets minWidth to their sum) and why it spreads evenly.
              These numbers are content widths, not a layout: the ratios between
              them are what survives at 2560px.
            */}
            <colgroup>
              <col style={{ width: 34 }} />
              <col style={{ width: 158 }} />
              <col style={{ width: 118 }} />
              <col style={{ width: 230 }} />
              <col style={{ width: 190 }} />
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
                const subQtys = list.flatMap(orderQtys);
                const subItems = list.reduce((s, o) => s + o.lines.length, 0);
                const subSales = list.reduce((s, o) => s + orderRevenue(o), 0);
                const subProfit = list.reduce((s, o) => s + orderProfit(o), 0);
                const subProfitKnown = list.every((o) => allCostsKnown(o.lines));

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
                              {formatUnitTotals(orderQtys(o))}
                            </td>
                            <td style={{ ...num, color: ARCH_SURFACE.textMid }} className="font-mono">
                              {o.lines.length}
                            </td>
                            <td style={{ ...num, fontWeight: 700 }} className="font-mono">
                              <Money n={orderRevenue(o)} currency={o.currency} />
                            </td>
                            <td
                              style={{
                                ...num,
                                fontWeight: 700,
                                paddingRight: 14,
                                color: allCostsKnown(o.lines)
                                  ? profitColor(orderMargin(o))
                                  : ARCH_SURFACE.textLight,
                              }}
                              className="font-mono"
                              title={
                                allCostsKnown(o.lines)
                                  ? undefined
                                  : 'At least one line has no lot cost, so this order has no profit figure.'
                              }
                            >
                              {allCostsKnown(o.lines) ? (
                                <Money n={orderProfit(o)} currency={o.currency} />
                              ) : (
                                UNKNOWN
                              )}
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
                                  ${(l.pricePerBF ?? 0).toFixed(2)}/{unitLabel(l.unit)}
                                </td>
                                <td style={{ ...num, padding: '6px 12px' }} className="font-mono">
                                  {formatQty(l.preSplitQty, l.unit)}
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
                                    color: costKnown(l)
                                      ? profitColor(lineMargin(l))
                                      : ARCH_SURFACE.textLight,
                                  }}
                                  className="font-mono"
                                  title={costKnown(l) ? undefined : 'No lot cost for this line.'}
                                >
                                  {costKnown(l) ? (
                                    <Money n={lineProfit(l)} currency={o.currency} />
                                  ) : (
                                    UNKNOWN
                                  )}
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
                        {formatUnitTotals(subQtys)}
                      </td>
                      <td style={{ ...num, color: ARCH_SURFACE.textMid }} className="font-mono">
                        {subItems}
                      </td>
                      {/* Currency DERIVED from this trader's own orders, not the
                          hard-coded "USD" that was here. A trader holding one
                          USD and one CAD order had both added together and the
                          result stamped USD. */}
                      {(() => {
                        const cur = [...new Set(list.map((o) => o.currency))];
                        const mixed = cur.length > 1;
                        return (
                          <>
                            <td style={{ ...num, fontWeight: 700 }} className="font-mono">
                              {mixed ? (
                                <span style={{ color: ARCH_SURFACE.textMid }} title={`Orders in ${cur.join(' and ')} — not summed`}>
                                  Mixed
                                </span>
                              ) : (
                                <Money n={subSales} currency={cur[0] || 'USD'} />
                              )}
                            </td>
                            <td style={{ ...num, fontWeight: 700, paddingRight: 14 }} className="font-mono">
                              {mixed ? (
                                <span style={{ color: ARCH_SURFACE.textMid }} title={`Orders in ${cur.join(' and ')} — not summed`}>
                                  Mixed
                                </span>
                              ) : subProfitKnown ? (
                                <Money n={subProfit} currency={cur[0] || 'USD'} />
                              ) : (
                                <span
                                  style={{ color: ARCH_SURFACE.textLight }}
                                  title="At least one line in this group has no lot cost."
                                >
                                  {UNKNOWN}
                                </span>
                              )}
                            </td>
                          </>
                        );
                      })()}
                    </tr>
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
