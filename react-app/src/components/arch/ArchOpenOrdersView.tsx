/**
 * Open Sales Orders — the trader screen's second tab.
 *
 * Orders grouped by a person, each group with a subtotal, header totals across
 * whatever is visible, and rows that expand to their line items.
 *
 * ── TWO people per order, and they are different people ─────────────────────
 * Marc-Antoine asked on 2026-09-08 for "la personne qui a créé le SO". The rep
 * who SOLD it and the user who SAVED it are not the same on real data: 'House
 * Blend 2' (our integration account) saved SO-CWP-001344 and 001345, while the
 * sales team on those orders is Camil Perrault. Showing the creator alone would
 * credit our own account for MGSL's sales; showing the rep alone is what the
 * client just told us was wrong. So BOTH are columns, both labelled, and the
 * grouping axis is a control rather than a decision baked in here.
 *
 * The default axis is CREATED BY, because that is what he asked for and because
 * it is read straight off the transaction: the rep comes from the
 * `transactionsalesteam` sublist, which a RESTlet reads as the CALLER'S role and
 * can therefore come back empty without anything looking broken. Grouping by the
 * field that cannot silently vanish, with the other one on every row, is the
 * arrangement where a failure is visible instead of quiet. See
 * lib/archTraderAttribution.
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
 *  - Edit is offered on EVERY real order, Ready to Build included, with a
 *    warning rather than a block. His call remark ("une fois qu'il est ready
 *    to build... on peut plus edit") was superseded by his written answer of
 *    2026-08-14: a warning « qui n'empeche pas le Edit ».
 *  - Lines carry their own status. ✅ THE CONTRADICTION IS CLOSED, not open: on
 *    2026-08-14 he confirmed the line origin AND chose a HEADER status for V1
 *    ("je pense que pour la V1 on peut y aller avec un statut sur le SO au
 *    complet"), because mixing the two would be confusing. No such field
 *    exists yet, so the status is still unreachable on real orders.
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
import { salesOrderUrl } from '@/lib/nsRecordUrl';
import { traderAttributionNotice, UNASSIGNED } from '@/lib/archTraderAttribution';
import { useNetSuite } from '@/context/NetSuiteContext';
import { useArchOpenOrders } from '@/hooks/useArchOpenOrders';
import type { ArchLiveOpenOrder, ArchOpenOrdersState } from '@/hooks/useArchOpenOrders';
import { setReadyToBuild } from '@/lib/archOrderApi';
import { shipWeekCell } from '@/lib/archLotOrders';
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

/* ── The two people on an order ──────────────────────────────────────────────*/

/**
 * Which of the two the list is grouped by. A control, not a decision: the client
 * asked for the creator, the rep is what the commission follows, and neither may
 * silently stand in for the other.
 */
type GroupAxis = 'creator' | 'rep';

/** Label used when the transaction carries no creator we could read. */
const CREATOR_UNKNOWN = 'Unknown';

const AXES: Record<GroupAxis, { band: string; all: string; aria: string }> = {
  creator: { band: 'Created by', all: 'All creators', aria: 'Filter by creator' },
  rep:     { band: 'Sales rep',  all: 'All sales reps', aria: 'Filter by sales rep' },
};

/** The service already resolves this to a name, an "Employee <id>", or Unassigned. */
const repOf = (o: ArchLiveOpenOrder): string => (o.trader || '').trim() || UNASSIGNED;

/**
 * ⚠️ NEVER the raw field. `createdBy` is '' on an order whose creator the
 * caller's role cannot read, and grouping on '' produces a band with no name and
 * a filter option that looks blank rather than absent.
 */
const creatorOf = (o: ArchLiveOpenOrder): string =>
  (o.createdBy || '').trim() || CREATOR_UNKNOWN;

const groupValue = (o: ArchLiveOpenOrder, axis: GroupAxis): string =>
  axis === 'rep' ? repOf(o) : creatorOf(o);

/** A name we could not read reads as absent, not as a person. */
const PersonCell = ({ name, placeholder, title }: { name: string; placeholder: string; title?: string }) =>
  name === placeholder ? (
    <span style={{ color: ARCH_SURFACE.textLight, fontStyle: 'italic' }} title={title}>
      {placeholder}
    </span>
  ) : (
    <>{name}</>
  );

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
  /**
   * The list, held by the parent so this tab and the wizard share ONE fetch.
   *
   * 🔴 Feedback 6 item 15, "il y a un bon délais (10 secondes) avant que l'info
   * apparraisse". Each of them used to own a hook instance, so clicking Edit in
   * this tab remounted the wizard and made it fetch, from scratch, the identical
   * list this tab was already displaying. Measured 2026-09-15: that call runs
   * 2.3s to 11.9s against the sandbox, and the wizard's header cannot fill until
   * it lands.
   *
   * Optional so the tab still stands alone; it falls back to its own hook, and
   * the fallback is disabled whenever the parent supplies one, so there is never
   * a second request in flight.
   */
  ordersState?: ArchOpenOrdersState;
}

export const ArchOpenOrdersView = ({ onEditOrder, ordersState }: ArchOpenOrdersViewProps) => {
  const ownOrders = useArchOpenOrders(!ordersState);
  const { orders, source, error, taggedItemCount, traderAttribution, transport, fallbackReason, degraded, reload } =
    ordersState || ownOrders;
  const { accountId } = useNetSuite();
  /*
   * Ready to Build toggle state. Keyed by `soNo` rather than `internalId`
   * because a fixture order's `internalId` is null and cannot key a Set/Record
   * distinctly (every fixture would collide on the same `null` key) — moot in
   * practice since the toggle only renders when `editable`, but keying on the
   * field that IS always distinct costs nothing and avoids relying on that.
   *
   * No local optimistic copy of `readyToBuild` is kept: on success this calls
   * `reload()` and lets the next fetch be the source of truth, the same
   * trust-but-verify preference the server side already applies to this same
   * write (`verifyReadyToBuild`). A brief re-fetch delay is a smaller risk
   * than a client-side copy silently drifting from what NetSuite actually
   * stored.
   */
  const [rtbBusy, setRtbBusy] = React.useState<Set<string>>(new Set());
  const [rtbError, setRtbError] = React.useState<Record<string, string>>({});
  /*
   * 🔴 THE TICK IS INVISIBLE ON THE INVENTORY GRID UNTIL THE CACHE REBUILDS, and
   * saying nothing about that is how a working tick reads as a broken one.
   *
   * `reload()` below re-reads THE ORDER LIST only, which since Feedback 6 item 15
   * is one list shared with the builder rather than this tab's private copy, so a
   * tick is reflected in both. The grid's READY TO BUILD column is
   * served from the hourly cache, and nothing in the write path busts it
   * (`mcgi_sl_arch_order_create.js` contains no cache reference at all). Measured
   * 2026-09-14: a tick landed at 18:5x against a cache last built 18:48:12Z, so
   * the column would not have moved for another 49 minutes.
   *
   * ⚠️ NOT a fixed sentence about "an hour". `TTL_SUMMARY` and `TTL_DETAIL` are
   * both 43200 (12h) against an hourly backstop, so a stalled chain stretches this
   * much further, and a hardcoded number would be confidently wrong exactly when
   * it matters most. The banner points at the header badge, which reads the
   * cache's own `lastUpdated` through `lib/archFreshness`.
   */
  const [rtbLagNotice, setRtbLagNotice] = React.useState<string | null>(null);
  const handleToggleReadyToBuild = React.useCallback(
    async (o: ArchLiveOpenOrder) => {
      if (!o.internalId || rtbBusy.has(o.soNo)) return;
      setRtbBusy((s) => new Set(s).add(o.soNo));
      setRtbError((e) => { const next = { ...e }; delete next[o.soNo]; return next; });
      const result = await setReadyToBuild(o.internalId, !o.readyToBuild);
      setRtbBusy((s) => { const next = new Set(s); next.delete(o.soNo); return next; });
      if (result.ok) {
        setRtbLagNotice(
          `${o.soNo} saved. This tab is up to date now, but the Hardwood tab's ` +
          `READY TO BUILD column is served from the cache, which rebuilds every 15 minutes, and will not ` +
          `show it until the next rebuild. The age of those figures is on the ` +
          `badge beside the date at the top.`
        );
        reload();
      } else {
        setRtbLagNotice(null);
        /*
         * NOT_STORED is a failure that CHANGED the record's neighbourhood: the
         * save went through and NetSuite read back something else, so this row
         * is now stale in a way a refusal or a dropped fetch never leaves it.
         * Re-read even while reporting the failure, so the checkbox shows what
         * NetSuite actually holds rather than what the trader clicked.
         */
        if (result.code === 'NOT_STORED') reload();
        setRtbError((e) => ({
          ...e,
          [o.soNo]: result.transportFailure
            ? (result.error || 'NetSuite did not answer.') + ' Reload before retrying.'
            : result.error || 'Ready to Build could not be changed.',
        }));
      }
    },
    [rtbBusy, reload],
  );
  /*
   * 🔴 'loading' is NOT demo. `isDemo` used to be `source !== 'netsuite'`, so the
   * whole in-flight window rendered "Demo data. These orders are placeholders, not
   * real sales orders ... this one is not connected" over an empty table -- a
   * confident false claim about live data that simply had not arrived.
   *
   * This change made that window materially longer, which is what surfaced it: the
   * order Suitelet is measurably slower than the RESTlet it now goes in front of,
   * and on the fallback legs the tab pays both round trips before anything renders.
   */
  const isLoading = source === 'loading';
  const isDemo = source === 'fixtures';

  /**
   * 🔴 GROUPED BY THE SALES REP BY DEFAULT. Changed 2026-09-14.
   *
   * This defaulted to the CREATOR, on the strength of "Ils affichent tous a
   * unassigned, mais devrait être la personne qui a créé le SO" (Marc-Antoine,
   * 2026-09-08). **He retracted that on the 2026-09-10 call at [32:00]**, having
   * seen what it actually produces:
   *
   *   "je pense qu'on s'est mal compris pour le created by, parce que là ici ce
   *    que je vois c'est que c'est comme, c'est created by Houseblend. Tu sais ce
   *    que je voulais dire c'est que ça peut arriver que moi je crée un sales
   *    order pour quelqu'un... il y a comme un owner, parce que le sales team ça
   *    peut être deux personnes, mais il y a toujours un owner du sales order
   *    quand même. Fait que là qu'on utilise le sales rep."
   *
   * And then, explicitly: "le sales rep il est ici. Comme ça, c'est la personne
   * qui a créé, puis après ça, le sales team est utilisé juste pour le split de
   * commission."
   *
   * Confirmed live in sandbox the same way he saw it, 2026-09-14: 7 open orders
   * banded as "House Blend 2" x6 and "Marc-Antoine Poirier" x1. The creator is the
   * integration account on almost every real order, so banding by it says nothing,
   * while the Sales Rep column underneath held Lucas Gibb, Alec Wolf and Camil
   * Perrault. Grouping by the creator was hiding the only axis with information in
   * it.
   *
   * The creator is NOT removed: it stays a column and a grouping option, because
   * "who keyed this in" is still a real question, just not the default one.
   *
   * ⚠️ No `anyCreator` fallback any more, and it is not needed. The old code fell
   * back to the rep when no order carried a `createdBy`, which existed for FIXTURE
   * orders; the rep is now the default in every case, so fixtures and live data
   * take the same path. `groupValue` still substitutes REP_UNKNOWN for a blank
   * rep, so an order with no rep bands honestly rather than disappearing.
   */
  const [axisOverride, setAxisOverride] = React.useState<GroupAxis | null>(null);
  const groupBy: GroupAxis = axisOverride !== null ? axisOverride : 'rep';
  const [groupFilter, setGroupFilter] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  /* The filter holds a NAME, and a name from one axis will not match the other,
     so a filter that survived an axis change would empty the table with nothing
     saying why. Keyed on the RESOLVED axis, so it covers the fallback above
     flipping when data arrives as well as the user changing the control. */
  React.useEffect(() => setGroupFilter(''), [groupBy]);

  /**
   * Names that actually appear in the data, on the ACTIVE axis, not the fixture
   * roster.
   *
   * The filter used to be populated from `TRADERS`, so with live orders it would
   * offer names nobody sold anything under and omit whoever did. TRADERS is still
   * imported for the COLOUR map, where a stable palette across the fixture and
   * live sets is what keeps a person the same colour between the two.
   */
  const namesPresent = React.useMemo(
    () => [...new Set(orders.map((o) => groupValue(o, groupBy)))].sort((a, b) => a.localeCompare(b)),
    [orders, groupBy]
  );
  /* Both axes feed the palette, so a person keeps one colour when the grouping is
     switched rather than being recoloured by their position in a different list. */
  const traderColors = React.useMemo(
    () =>
      traderColorMap([
        ...new Set([
          ...TRADERS,
          ...orders.map(repOf),
          ...orders.map(creatorOf),
        ]),
      ]),
    [orders]
  );

  const visible = React.useMemo(
    () => (groupFilter ? orders.filter((o) => groupValue(o, groupBy) === groupFilter) : orders),
    [orders, groupFilter, groupBy]
  );

  const groups = React.useMemo(() => {
    const byName = new Map<string, ArchLiveOpenOrder[]>();
    visible.forEach((o) => {
      const k = groupValue(o, groupBy);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k)!.push(o);
    });
    return [...byName.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible, groupBy]);

  /**
   * 🔴 SAYS SO WHEN THE REP COLUMN IS UNREAD RATHER THAN EMPTY.
   *
   * The whole reason this tab said "Unassigned" everywhere is that it read a
   * header field that is null on every ARCH order. The replacement reads the
   * Sales Team sublist from inside a RESTlet, which runs as the CALLER, and
   * nobody has been able to exercise the trader's own role. If that read comes
   * back empty the tab regresses to the identical symptom, so it has to be able
   * to tell the trader that the column is unread. See lib/archTraderAttribution.
   */
  const attNotice = React.useMemo(
    () =>
      traderAttributionNotice({
        source,
        orderCount: traderAttribution ? traderAttribution.orders : orders.length,
        unattributedCount: traderAttribution ? traderAttribution.unattributed : 0,
        namesUnreadable: traderAttribution ? traderAttribution.namesUnreadable : 0,
        salesTeamRead: traderAttribution ? traderAttribution.salesTeamRead : 'unknown',
        salesTeamError: traderAttribution ? traderAttribution.salesTeamError : '',
        roleLabel: traderAttribution ? traderAttribution.roleLabel : '',
        transport: transport || undefined,
      }),
    [source, orders.length, traderAttribution, transport]
  );

  /*
   * The degradation reasons WORTH SHOWING here, which is not all of them: the
   * sales-team failure already has its own banner via `attNotice` (the fourth
   * state below), and saying it twice reads as two problems. Everything else has
   * no other home.
   */
  const visibleDegradations = React.useMemo(
    () => degraded.filter((d) => !(attNotice && d.indexOf('sales-team') !== -1)),
    [degraded, attNotice]
  );

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

        The third state is the interesting one. Live and EMPTY used to be the
        normal case, because the scope was a Hardwood segment and then a Hardwood
        department that most real orders did not carry. Since 2026-09-22 the scope
        is subsidiary ARC (Feedback 14) and the tab is populated in sandbox, but an
        empty tab can still mean "orders you cannot read", so it still says why.
        A blank table would read as "no open orders", which is the wrong
        conclusion to hand somebody.
      */}
      {isLoading && orders.length === 0 ? (
        /*
          🔴 THE FIRST STATE, and it did not exist. `isDemo` was
          `source !== 'netsuite'`, which is TRUE while loading, so the whole
          in-flight window asserted "Demo data. These orders are placeholders, not
          real sales orders" over live data that had simply not arrived yet, and
          told the trader "this one is not connected" about a tab that was.

          Splitting demo from loading moved the problem rather than fixing it: with
          `isDemo` false and no orders yet, the chain fell through to "Live, and
          nothing to show", which is the same false confidence in a calmer voice.
          Both are claims about an answer nobody has.

          Gated on `orders.length === 0` so a RELOAD keeps the previous list on
          screen instead of blanking it, which is what the Refresh button wants.
        */
        <div style={{ ...notice, background: '#F8FAFC', borderBottom: '1px solid #CBD5E1', color: '#475569' }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>⏳</span>
          <span>Reading open sales orders from NetSuite.</span>
        </div>
      ) : isDemo ? (
        <div style={{ ...notice, background: '#FFF8E1', borderBottom: '1px solid #E6B800', color: '#7A4100' }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
          <span>
            <strong>Demo data.</strong> These orders are placeholders, not real sales orders —
            the customers, SO numbers and quantities are invented, and none of them can be
            added to. {error || 'The Hardwood tab is live; this one is not connected.'}
          </span>
        </div>
      ) : orders.length === 0 ? (
        /*
          LIVE AND EMPTY, and the reason depends on WHICH LEG answered.

          🔴 This banner used to assert one cause unconditionally: "No open sales
          order carries a hardwood-tagged item", then advise tagging more SKUs.
          Under the real trader role that was affirmatively FALSE and it sent the
          client off to do the wrong work -- 8 open orders DID carry tagged items
          (measured 2026-09-10, taggedItemCount 6), and role 2181 simply could not
          see any of them because SALESCENTER narrows a transaction search to the
          role's own records. That is item 5.b, and the banner was the half of it
          that no data fix touches.

          So: name the cause that can actually apply to the leg that answered, and
          never both at once.

          ⚠️ `taggedItemCount` is itself read by whichever role served the request
          (HARDWOOD_ITEM_COUNT_SQL runs in the same execution), so it is not an
          account fact and the copy no longer calls it one.

          ⚠️ Updated 2026-09-10: the count and the copy both moved from the
          Hardwood SEGMENT to Department 11 ("Hardwood") — see the cache MR's
          header comment. The count is therefore much larger now (~142, not 6)
          and that is expected, not a regression.

          ⚠️ Updated again 2026-09-22 (Feedback 12/14): the scope is subsidiary
          ARC, and the copy below says so. 143 items in sandbox today.
        */
        <div style={{ ...notice, background: '#EFF6FF', borderBottom: '1px solid #93C5FD', color: '#1E40AF' }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>ℹ️</span>
          <span>
            <strong>Live, and nothing to show.</strong> No open sales order that this
            request could read carries an item in subsidiary ARC.
            {taggedItemCount !== null ? (
              <> This request could see {taggedItemCount} item
                {taggedItemCount === 1 ? '' : 's'} in subsidiary ARC, so orders on items
                outside it cannot appear here.</>
            ) : (
              <> The ARC item count could not be read, so this banner cannot say how many
                items are in scope.</>
            )}{' '}
            {/*
              Feedback 12, 2026-09-22: the "tag the remaining hardwood items" advice
              is gone. The scope is subsidiary ARC (Feedback 14), so there is nothing
              to tag; that sentence sent the client to do work that fixes nothing.
              Each leg still names only the cause that can apply to it.
            */}
            {transport === 'restlet' ? (
              <> This list was read under <strong>your own role</strong>, and a role scoped
                to its own transactions returns nothing here even when the orders exist,
                so this banner cannot tell "no ARC orders" from "orders you cannot read".</>
            ) : transport === 'endpoint' ? (
              <> This list was read by the order endpoint rather than under your own role,
                so being scoped to your own transactions is <em>not</em> the cause. The
                endpoint is scoped to selected subsidiaries, so an order booked outside
                them would also not appear.</>
            ) : null}
          </span>
        </div>
      ) : attNotice ? (
        /*
          THE FOURTH STATE: live, populated, and the SALES REP column cannot be
          trusted. Mutually exclusive with the two above by construction —
          `traderAttributionNotice` returns null on fixtures and on an empty tab —
          so this never stacks under another banner.

          🔴 Why it exists. The reported bug was "Unassigned on every row", caused
          by reading a header field that is null on every ARCH order. The rep now
          comes from the `transactionsalesteam` sublist, read inside a RESTlet,
          which IGNORES runasrole and runs as the CALLER. Every measurement behind
          that read was taken as Administrator; nobody can log in as the trader's
          own role from here. If it comes back empty for the real users the tab
          regresses to the identical symptom, and without this it would do so in
          silence. Saying "unread" is not the same as printing "Unassigned".
        */
        <div
          style={{
            ...notice,
            ...(attNotice.level === 'error'
              ? { background: '#FEF2F2', borderBottom: '1px solid #FCA5A5', color: '#991B1B' }
              : { background: '#FFF8E1', borderBottom: '1px solid #E6B800', color: '#7A4100' }),
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>{attNotice.level === 'error' ? '🔴' : '⚠️'}</span>
          <span>
            <strong>
              {attNotice.level === 'error' ? 'Sales rep unread.' : 'Sales rep incomplete.'}
            </strong>{' '}
            {attNotice.lines.join(' ')}
          </span>
        </div>
      ) : null}
      {/*
        THE FIFTH STATE: live, POPULATED, and the answer is known to be less than
        whole. Rendered outside the chain above on purpose, because it is not
        mutually exclusive with the rep banner: a tab can have both an unread rep
        column and an uncosted line.

        🔴 WHY A POPULATED TAB NEEDS A BANNER AT ALL. The endpoint-first chain
        falls back to the RESTlet only when the endpoint TOTAL-fails, and the
        service is built never to total-fail: three catch blocks swallow a failed
        cost lookup, a failed sales-team read and a failed tagged-item count, and
        each still returns `success: true` with a full order list. Without this the
        screen prints a confident "N open orders" and a totals row over data that
        quietly lost a column -- which is item 5.b's own failure shape, relocated.

        And the RESTlet leg keeps the original bug by definition. Any role outside
        the endpoint deployment's allowlist [2181, 3] is refused by the Suitelet,
        falls back, and reads the list under its own role. If that role narrows,
        the tab is a subset and nothing else on screen would say so.

        ⚠️ What this CANNOT see: an order scoped away at row level.
        `OPEN_ORDERS_SQL` carries no subsidiary predicate, the DTO carries no
        subsidiary, and nothing counts what the executing role could not read, so a
        hidden order is indistinguishable from an order that does not exist.
        Detecting that needs a field on the server DTO and is not invented here.
      */}
      {!isDemo && !isLoading && orders.length > 0 &&
       (visibleDegradations.length > 0 || transport === 'restlet') ? (
        <div style={{ ...notice, background: '#FFF8E1', borderBottom: '1px solid #E6B800', color: '#7A4100' }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
          <span>
            {/* Round-2 review, 2026-09-22: on the ENDPOINT leg every degradation is a
                missing column (cost, rep, item count), never a missing order, so the
                old headline told MA the list was incomplete right after he asked for
                it to be fixed, over a list that was 28 of 28. Only the RESTlet leg
                can actually be missing orders. */}
            <strong>{transport === 'restlet' ? 'This list may not be complete.' : 'Some figures on this tab are incomplete.'}</strong>{' '}
            {/*
              🔴 NAME THE REASON, do not name the commonest-sounding one. This
              sentence used to read "The order endpoint did not answer" for all
              three ways the RESTlet ends up serving, and that is false for two of
              them.

              'refused' is not the exotic case, it is the MAJORITY case: the React
              screen is deployed to all employees while the order endpoint permits
              only roles [2181, 3], so most viewers are refused instantly. Telling
              them the endpoint "did not answer" is both untrue and unactionable --
              what they can act on is that their role is not on its allowlist.

              'unconfigured' is a claim about a request that never left the browser.
            */}
            {transport === 'restlet' ? (
              fallbackReason === 'refused' ? (
                <>Your role is not on the order endpoint allowlist, so these orders were read
                  under your own role instead. A role scoped to its own transactions shows
                  only a subset.{' '}</>
              ) : fallbackReason === 'unconfigured' ? (
                <>No order endpoint is configured here, so these orders were read under your
                  own role. A role scoped to its own transactions shows only a subset.{' '}</>
              ) : (
                <>The order endpoint did not answer, so these orders were read under your own
                  role. A role scoped to its own transactions shows only a subset.{' '}</>
              )
            ) : null}
            {/* Each reason is written to start lowercase so it can follow a clause;
                the first one here follows a full stop, so it is capitalised. */}
            {visibleDegradations.length > 0
              ? visibleDegradations
                  .map((r, i) => (i === 0 ? r.charAt(0).toUpperCase() + r.slice(1) : r))
                  .join('; ') + '.'
              : null}
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
            {groupFilter && <span style={{ color: ARCH_SURFACE.textLight }}> · filtered</span>}
          </div>
        </div>

        {/* Which of the two people the list is banded by. Both stay on every row. */}
        <select
          value={groupBy}
          onChange={(e) => setAxisOverride(e.target.value as GroupAxis)}
          aria-label="Group orders by"
          style={{ ...control, minWidth: 168 }}
        >
          <option value="creator">Group by: Created by</option>
          <option value="rep">Group by: Sales rep</option>
        </select>

        {/* Filters on whatever the grouping axis is, so the control and the bands
            cannot disagree about which person is being talked about. */}
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          aria-label={AXES[groupBy].aria}
          style={{ ...control, minWidth: 168 }}
        >
          <option value="">{AXES[groupBy].all}</option>
          {namesPresent.map((t) => (
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

      {/* A tick lands here instantly and on the Hardwood grid only at the next
          cache rebuild. Said once, dismissible, and never a number: see the note
          on `rtbLagNotice`. */}
      {rtbLagNotice && (
        <div style={{ padding: `0 ${PAD_L}px 10px` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 8,
              background: '#EFF6FF',
              border: '1px solid #BFDBFE',
              fontSize: 11.5,
              lineHeight: 1.5,
              color: ARCH_SURFACE.text,
            }}
          >
            <span aria-hidden="true">🕒</span>
            <span style={{ flex: 1 }}>{rtbLagNotice}</span>
            <button
              type="button"
              onClick={() => setRtbLagNotice(null)}
              aria-label="Dismiss"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: ARCH_SURFACE.textLight, fontSize: 13, lineHeight: 1, padding: 0,
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

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
              Once all twelve carry a width the surplus is shared in proportion,
              which is what the Hardwood grid does (it sizes every column and
              sets minWidth to their sum) and why it spreads evenly.
              These numbers are content widths, not a layout: the ratios between
              them are what survives at 2560px.
            */}
            {/* TWELVE columns since 2026-09-08: Sales rep and Created by are both
                here. They are different people on real orders, and the client
                asked for the second one, so neither may be the only one shown. */}
            <colgroup>
              <col style={{ width: 34 }} />
              <col style={{ width: 158 }} />
              <col style={{ width: 118 }} />
              <col style={{ width: 206 }} />
              <col style={{ width: 132 }} />
              <col style={{ width: 132 }} />
              <col style={{ width: 154 }} />
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
                <th style={{ ...th, textAlign: 'left' }} title="The rep credited on the order's Sales Team sublist.">
                  Sales rep
                </th>
                <th style={{ ...th, textAlign: 'left' }} title="The NetSuite user who saved the sales order.">
                  Created by
                </th>
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
                  <td colSpan={12} style={{ padding: '44px 0', textAlign: 'center', color: ARCH_SURFACE.textLight, fontSize: 12.5 }}>
                    No open orders for this {groupBy === 'rep' ? 'sales rep' : 'creator'}.
                  </td>
                </tr>
              </tbody>
            ) : (
              groups.map(([groupName, list]) => {
                const subQtys = list.flatMap(orderQtys);
                const subItems = list.reduce((s, o) => s + o.lines.length, 0);
                const subSales = list.reduce((s, o) => s + orderRevenue(o), 0);
                const subProfit = list.reduce((s, o) => s + orderProfit(o), 0);
                const subProfitKnown = list.every((o) => allCostsKnown(o.lines));

                return (
                  <tbody key={groupName}>
                    {/* Group band. LABELLED with the axis: a bare name over a list
                        of orders is exactly the ambiguity that let a sales rep read
                        as "the person who created the SO" and vice versa. */}
                    <tr>
                      <td colSpan={12} style={{ padding: 0 }}>
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
                              background: traderColors[groupName] || '#64748B',
                              color: '#fff',
                              fontSize: 8.5,
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {traderInitials(groupName)}
                          </span>
                          <span
                            style={{
                              color: '#93A9C0',
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: '0.07em',
                              textTransform: 'uppercase',
                            }}
                          >
                            {AXES[groupBy].band}
                          </span>
                          <span style={{ color: '#fff', fontSize: 12.5, fontWeight: 700 }}>{groupName}</span>
                          <span style={{ color: '#93A9C0', fontSize: 11 }}>
                            {list.length} open order{list.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {list.map((o, i) => {
                      const isOpen = !!expanded[o.soNo];
                      /* '' on a fixture order, where internalId is null by
                         construction. No link is offered then, rather than one
                         that lands on a NetSuite 404. */
                      const soUrl = salesOrderUrl(o.internalId, accountId);
                      // "Une fois qu'il est ready to build... on peut plus edit."
                      // And never on a fixture order: internalId is null there by
                      // construction, so the write path could not append to it, and
                      // offering Edit walked the trader into a wizard that ends in a
                      // refusal.
                      /* 🔴 READY TO BUILD NO LONGER BLOCKS. Corrected 2026-09-09.
                       * Marc-Antoine, in writing 2026-08-14 11:33, superseding his own
                       * call remark: « on pourrait afficher un warning qui n'empeche pas
                       * le Edit, mais qui le mentionne au trader ». Only a fixture order
                       * (no internalId, so no write target) is genuinely uneditable. */
                      const editable = !!o.internalId;
                      const buildWarning = o.status === 'Ready to Build';
                      /* Something has already left the building, so Ready to Build
                       * can no longer change anything. 'In Transit' is exactly the
                       * D/E/F case: `archStatusFor` maps those three and only those
                       * to this pill, and its own comment says "A and B are the only
                       * statuses where the tick is meaningful".
                       *
                       * 🔴 The TICK WAS A SILENT NO-OP HERE until 2026-09-14. The
                       * cache buckets on `open = max(0, ordered - moved)`, which is
                       * 0 once a line is fully shipped, so ticking a shipped order
                       * wrote the field, reported success, and moved no number on
                       * any screen. Three of the seven open orders were in that
                       * state when the deployed screen was opened. */
                      const shippedAlready = o.status === 'In Transit';
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
                              {/*
                                THE SO NUMBER OPENS THE ORDER IN NETSUITE, in a new
                                tab. "Est-ce que lorsqu'on clique sur le numéro du
                                SO ça nous redirige vers le form dans Netsuite?"
                                (Marc-Antoine, 2026-09-08) — the answer was no: it
                                was a button that toggled the row, because the
                                earlier version of this tab had only fixtures and no
                                internal ids to link to.

                                Expanding is still one click away and always was:
                                the caret in the first column of every row, and
                                Expand all in the header. Neither moved.

                                A fixture order keeps the button, because it has no
                                internal id and a link would go nowhere. See
                                lib/nsRecordUrl for the sandbox host handling.
                              */}
                              {soUrl ? (
                                <a
                                  href={soUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono"
                                  title={`Open ${o.soNo} in NetSuite (new tab)`}
                                  style={{
                                    fontWeight: 700,
                                    color: '#1A6FE0',
                                    fontSize: 11.5,
                                    textDecoration: 'none',
                                  }}
                                >
                                  {o.soNo}
                                </a>
                              ) : (
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
                              )}
                              {/* Hidden entirely on a fixture order, where internalId is
                                  null and the append could not resolve a target. That also
                                  means a RESTlet failure, which falls the whole tab back to
                                  fixtures, removes Edit from every row - so say why rather
                                  than leaving the affordance silently absent. */}
                              {!editable && !o.internalId && (
                                <span
                                  /* The build warning has to ride along here too, not only
                                     on the Edit button below. Edit renders only when
                                     editable, and a fixture order is the only thing that
                                     currently carries 'Ready to Build', so attaching the
                                     warning solely to Edit made it unreachable. Corrected
                                     2026-09-10, pinned by archUiGuards.test.mjs. */
                                  title={
                                    buildWarning
                                      ? 'These are demo orders because the live list could not be loaded, so they cannot be edited. Ready to Build: the warehouse may already be preparing it, so check with them first.'
                                      : 'These are demo orders because the live list could not be loaded, so they cannot be edited.'
                                  }
                                  style={{ marginLeft: 6, fontSize: 10, color: ARCH_SURFACE.textLight }}
                                >
                                  demo
                                </span>
                              )}
                              {editable && (
                                <button
                                  type="button"
                                  onClick={() => onEditOrder?.(o.soNo)}
                                  /* The warning he asked for instead of a block, 2026-08-14:
                                     « un warning qui n'empeche pas le Edit, mais qui le
                                     mentionne au trader que la commande est peut-etre en
                                     cours de preparation. » */
                                  title={
                                    buildWarning
                                      ? `Add items to ${o.soNo}. Ready to Build: the warehouse may already be preparing it, so check with them first.`
                                      : `Add items to ${o.soNo}`
                                  }
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
                              {/*
                                The manual tick behind `readyToBuild`. Only on a
                                real order (`editable`, same gate as Edit above):
                                a fixture's `internalId` is null and there is no
                                NetSuite record to write to. Shown regardless of
                                whether `readyToBuild` currently landed the pill
                                on 'Ready to Build' or 'In Transit' — see the type
                                comment on `ArchLiveOpenOrder.readyToBuild` for why
                                the raw flag and the pill can legitimately differ
                                once an order ships.
                              */}
                              {editable && (
                                <label
                                  title={
                                    rtbError[o.soNo]
                                      ? rtbError[o.soNo]
                                      : shippedAlready
                                        ? 'This order has already shipped, so Ready to Build no longer applies. Ticking it would change no figure on any screen.'
                                        : o.readyToBuild
                                          ? 'Ready to build. Untick to move it back to Reserved.'
                                          : 'Not yet marked ready to build.'
                                  }
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    marginLeft: 8,
                                    fontSize: 9.5,
                                    fontWeight: 700,
                                    color: rtbError[o.soNo] ? '#B42318' : ARCH_SURFACE.textLight,
                                    // Greyed rather than hidden: the trader should see that the
                                    // control exists and why it is unavailable here, not wonder
                                    // why this row is missing something every other row has.
                                    opacity: shippedAlready ? 0.45 : 1,
                                    cursor: rtbBusy.has(o.soNo) || shippedAlready ? 'default' : 'pointer',
                                    verticalAlign: '1px',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!o.readyToBuild}
                                    disabled={rtbBusy.has(o.soNo) || shippedAlready}
                                    onChange={() => handleToggleReadyToBuild(o)}
                                    style={{ margin: 0, cursor: 'inherit' }}
                                  />
                                  {rtbBusy.has(o.soNo) ? '…' : 'Build'}
                                </label>
                              )}
                            </td>
                            <td style={{ ...td, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {o.customer}
                            </td>
                            {/* BOTH people, on every row, whichever axis is banded.
                                The client asked for the creator; the rep is who the
                                commission follows. Substituting either for the other
                                is the mistake this column pair exists to prevent. */}
                            <td
                              style={{
                                ...td,
                                color: ARCH_SURFACE.textMid,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={
                                repOf(o) === UNASSIGNED
                                  ? 'No rep on this order’s Sales Team sublist and none on its header.'
                                  : `Sales rep${o.traderId ? ` (employee ${o.traderId})` : ''}`
                              }
                            >
                              <PersonCell
                                name={repOf(o)}
                                placeholder={UNASSIGNED}
                                title="No rep on this order’s Sales Team sublist and none on its header."
                              />
                              {/* A 50/50 split with no primary is a coin toss, and the
                                  service flags it precisely so the tab need not pretend
                                  otherwise. Only the TIED case is marked; an unequal
                                  split has a defensible winner. */}
                              {o.traderTied && (
                                <span
                                  title="This order's Sales Team splits evenly with no primary, so one of them was picked by lowest employee id."
                                  style={{ marginLeft: 5, fontSize: 9.5, color: ARCH_SURFACE.textLight }}
                                >
                                  tied
                                </span>
                              )}
                            </td>
                            <td
                              style={{
                                ...td,
                                color: ARCH_SURFACE.textMid,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={
                                creatorOf(o) === CREATOR_UNKNOWN
                                  ? 'NetSuite returned no creator for this order.'
                                  : `Saved this order${o.createdById ? ` (employee ${o.createdById})` : ''}`
                              }
                            >
                              <PersonCell
                                name={creatorOf(o)}
                                placeholder={CREATOR_UNKNOWN}
                                title="NetSuite returned no creator for this order."
                              />
                            </td>
                            <td style={{ ...td, color: ARCH_SURFACE.textMid, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {locationLabel(o)}
                            </td>
                            <td
                              style={{ ...td, color: ARCH_SURFACE.textMid, whiteSpace: 'nowrap' }}
                              title={shipWeekCell(o.shipDate, o.created, shipWeek).title}
                            >
                              {shipWeekCell(o.shipDate, o.created, shipWeek).text}
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
                                {/* Sales rep and Created by are ORDER-level facts, so
                                    the breakdown rows leave those two columns empty
                                    rather than repeating the header's answer per lot. */}
                                <td style={{ ...td, padding: '6px 12px' }} />
                                <td style={{ ...td, padding: '6px 12px' }} />
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
                        colSpan={7}
                        style={{
                          ...td,
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: ARCH_SURFACE.textMid,
                        }}
                      >
                        Subtotal · {AXES[groupBy].band} · {groupName}
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
