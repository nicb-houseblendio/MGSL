import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatBF } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import {
  SPLIT_FEE,
  PLANING_RATE,
  CUT_RATE,
  OPS_INSURANCE_RATE,
  lineEconomics,
  sumEconomics,
  orderedBF,
  fmtMoney,
  fmtPct,
  marginColor,
  planingOptions,
} from '@/lib/archOrderPricing';
import {
  CUSTOMERS,
  INCOTERMS,
  SALES_TEAMS,
  SALES_TEAM_NAMES,
  addressesFor,
  currenciesFor,
  paymentTermsFor,
  salesTeamFor,
  getOpenOrders,
} from '@/lib/archOrderFixtures';
import type {
  ArchCartLine,
  ArchOrderDraft,
  ArchOrderMode,
  ArchRemanIntent,
  ArchSplitIntent,
} from '@/types/archOrder';

/**
 * The sales-order builder — the reason CWP ARCH has its own screen.
 *
 * Seven steps, mirroring the prototype: Start, Items, Customer & terms, Bundle
 * split, Remanufacturing, Pricing, Review.
 *
 * ⚠️ IT DOES NOT WRITE TO NETSUITE. Create produces an `ArchOrderDraft` and hands
 * it to the caller. Four things have to be decided before persistence can be
 * built, and every one of them changes the payload:
 *   - how a split line is marked (custom record vs checkbox)
 *   - where reman and cutting live on the SO (description vs dedicated fields)
 *   - the real fee rates (everything here is a placeholder)
 *   - the SO header field IDs
 * The steps that depend on those are labelled provisional in the UI so nobody
 * mistakes a placeholder for a decision.
 */

type StepKey = 'start' | 'items' | 'customer' | 'split' | 'reman' | 'price' | 'review';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'start', label: 'Start' },
  { key: 'items', label: 'Items' },
  { key: 'customer', label: 'Customer & terms' },
  { key: 'split', label: 'Bundle split' },
  { key: 'reman', label: 'Remanufacturing' },
  { key: 'price', label: 'Pricing' },
  { key: 'review', label: 'Review' },
];

const CUT_LENGTHS = ["6'", "7'", "8'", "10'", "12'", "14'", "16'"];

interface SOWizardProps {
  open: boolean;
  cart: ArchCartLine[];
  onClose: () => void;
  onRemoveLine: (key: string) => void;
  /** Called on Create with the assembled draft. Persistence is not built yet. */
  onCreate: (draft: ArchOrderDraft) => void;
  /** Return to the grid to pick more lots. */
  onAddMoreItems: () => void;
  /**
   * Open straight onto an existing order, skipping the Start step.
   *
   * Set by Edit on the Open Sales Orders tab. The trader has already told us
   * which order they mean, so asking them again on step 1 would be busywork.
   */
  initialExistingSO?: string;
}

/**
 * Identity of the PHYSICAL BUNDLE, independent of how the line was created.
 *
 * Cart lines are keyed `internalId|lotNo` while existing-order lines are keyed
 * `so:<soNo>|lotNo`, so the two key spaces can never be compared directly.
 * Matching on `lotNo` alone was the wrong granularity in the other direction:
 * two rows differing by item or location but sharing a lot number would be
 * treated as the same bundle, and one of them silently dropped.
 */
const bundleId = (l: ArchCartLine): string => `${l.internalId}|${l.lotNo}`;

const emptySplit = (): ArchSplitIntent => ({ on: false, targetBF: '' });
const emptyReman = (): ArchRemanIntent => ({
  planing: false,
  planingSpec: '',
  planingOther: '',
  cutting: false,
  cutLength: '',
});

/* ── Small presentational helpers ───────────────────────────────────────────*/

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 10.5,
  fontWeight: 700,
  color: ARCH_SURFACE.textMid,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 6,
};

const field = (ok: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '10px 11px',
  borderRadius: 8,
  fontSize: 13.5,
  boxSizing: 'border-box',
  border: `1.5px solid ${ok ? ARCH_SURFACE.green : '#CBD5E1'}`,
  outline: 'none',
  color: ARCH_SURFACE.text,
  background: '#fff',
});

const numField: React.CSSProperties = {
  fontSize: 13,
  padding: '7px 9px',
  borderRadius: 7,
  border: '1.5px solid #CBD5E1',
  outline: 'none',
  width: 110,
  textAlign: 'right',
  color: ARCH_SURFACE.text,
  boxSizing: 'border-box',
};

const th: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: ARCH_SURFACE.textMid,
  background: 'linear-gradient(to bottom,#F1F5FA,#E8EDF5)',
  borderBottom: '2px solid #CBD5E1',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const td: React.CSSProperties = {
  padding: '9px 10px',
  borderBottom: '1px solid #E2E8F0',
  fontSize: 12.5,
  color: ARCH_SURFACE.text,
  verticalAlign: 'middle',
};

/** Loud, deliberate notice that a step is built on unconfirmed inputs. */
const ProvisionalNote = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      display: 'flex',
      gap: 9,
      alignItems: 'flex-start',
      padding: '9px 12px',
      borderRadius: 9,
      background: '#FFF8E1',
      border: '1px solid #E6B800',
      fontSize: 11.5,
      color: '#7A4100',
      lineHeight: 1.5,
      marginBottom: 14,
    }}
  >
    <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
    <span>{children}</span>
  </div>
);

const LotCell = ({ line }: { line: ArchCartLine }) => (
  <td style={td}>
    <div style={{ fontWeight: 600, fontSize: 12 }}>{line.description}</div>
    <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="font-mono" style={{ fontWeight: 700, color: ARCH_SURFACE.navyMid, fontSize: 11.5 }}>
        {line.lotNo}
      </span>
      {line.containerNo && (
        <span
          className="font-mono"
          title="Container #"
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: ARCH_SURFACE.navyMid,
            background: '#EEF2FB',
            border: '1px solid #E2E8F0',
            borderRadius: 4,
            padding: '1px 5px',
          }}
        >
          {line.containerNo}
        </span>
      )}
      {line.existing && (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: '#B36B16',
            background: '#FBF1E5',
            borderRadius: 4,
            padding: '1px 5px',
          }}
        >
          On order
        </span>
      )}
    </div>
  </td>
);

export const SOWizard = ({
  open,
  cart,
  onClose,
  onRemoveLine,
  onCreate,
  onAddMoreItems,
  initialExistingSO,
}: SOWizardProps) => {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [mode, setMode] = React.useState<ArchOrderMode>('new');
  const [existingSO, setExistingSO] = React.useState('');
  const [soSearch, setSoSearch] = React.useState('');

  const [customer, setCustomer] = React.useState('');
  const [customerPO, setCustomerPO] = React.useState('');
  const [shipTo, setShipTo] = React.useState('');
  const [currency, setCurrency] = React.useState('');
  const [shipDate, setShipDate] = React.useState('');
  const [incoterms, setIncoterms] = React.useState('');
  const [salesTeam, setSalesTeam] = React.useState('');

  const [split, setSplit] = React.useState<Record<string, ArchSplitIntent>>({});
  const [reman, setReman] = React.useState<Record<string, ArchRemanIntent>>({});
  const [price, setPrice] = React.useState<Record<string, string>>({});

  const openOrders = React.useMemo(() => getOpenOrders(), []);
  const chosenOrder = openOrders.find((o) => o.soNo === existingSO) || null;

  /**
   * Lines already on the chosen SO first, then the lots picked off the grid —
   * with cart lots the order ALREADY holds dropped.
   *
   * Three of the six seeded orders contain a lot that is also selectable on the
   * grid. Without this filter, adding it produced two rows for one physical
   * bundle, doubling its board feet and revenue on every downstream step.
   */
  const lines = React.useMemo<ArchCartLine[]>(() => {
    if (mode !== 'existing' || !chosenOrder) return cart;
    const onOrder = new Set(chosenOrder.lines.map(bundleId));
    return [...chosenOrder.lines, ...cart.filter((l) => !onOrder.has(bundleId(l)))];
  }, [mode, chosenOrder, cart]);

  /** Cart lots skipped because the chosen order already has them — surfaced on Items. */
  const alreadyOnOrder = React.useMemo(() => {
    if (mode !== 'existing' || !chosenOrder) return [];
    const onOrder = new Set(chosenOrder.lines.map(bundleId));
    return cart.filter((l) => onOrder.has(bundleId(l)));
  }, [mode, chosenOrder, cart]);

  const sp = (k: string) => split[k] || emptySplit();
  const rm = (k: string) => reman[k] || emptyReman();
  const pr = (k: string) => price[k] ?? '';

  const setSp = (k: string, patch: Partial<ArchSplitIntent>) =>
    setSplit((m) => ({ ...m, [k]: { ...sp(k), ...patch } }));
  const setRm = (k: string, patch: Partial<ArchRemanIntent>) =>
    setReman((m) => ({ ...m, [k]: { ...rm(k), ...patch } }));

  const applyExistingOrder = (soNo: string) => {
    const o = openOrders.find((x) => x.soNo === soNo);
    setExistingSO(soNo);
    if (!o) return;
    setCustomer(o.customer);
    setShipTo(o.shipTo);
    setCurrency(o.currency);
    setIncoterms(o.incoterms);
    setSalesTeam(o.salesTeam || salesTeamFor(o.customer));
    setShipDate(o.shipDate || '');
    // Carry the agreed price across so Pricing is already satisfied for lines
    // that are already sold. The trader only has to price what they just added.
    setPrice((prev) => {
      const next = { ...prev };
      o.lines.forEach((l) => {
        if (l.pricePerBF != null && next[l.key] == null) next[l.key] = String(l.pricePerBF);
      });
      return next;
    });
  };

  const pickCustomer = (c: string) => {
    setCustomer(c);
    setShipTo('');
    setSalesTeam(salesTeamFor(c));
    setCurrency(currenciesFor(c)[0]);
  };

  /* ── Economics ────────────────────────────────────────────────────────────*/

  const economics = React.useMemo(
    () => lines.map((l) => lineEconomics(l, sp(l.key), rm(l.key), parseFloat(pr(l.key)) || 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, split, reman, price]
  );
  const totals = React.useMemo(() => sumEconomics(economics), [economics]);

  /* ── Validation ───────────────────────────────────────────────────────────*/

  /**
   * Preload when opened from Edit. Runs on the value rather than on mount so a
   * second Edit, on a different order, re-primes the wizard even if React has
   * kept the instance alive.
   */
  React.useEffect(() => {
    if (!initialExistingSO) return;
    setMode('existing');
    applyExistingOrder(initialExistingSO);
    setStepIndex(1);
    // applyExistingOrder is recreated every render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExistingSO]);

  const startOk = mode === 'new' || !!existingSO;
  const itemsOk = lines.length > 0;
  const headerOk = !!(customer && shipTo && currency && shipDate && incoterms && salesTeam);
  const splitOk = lines.every((l) => {
    const s = sp(l.key);
    if (!s.on) return true;
    const v = parseFloat(s.targetBF);
    // Must be a real quantity and cannot exceed what the bundle holds.
    return v > 0 && v <= l.bf + 1e-9;
  });
  const remanOk = lines.every((l) => {
    const r = rm(l.key);
    const planingDone =
      !r.planing || (!!r.planingSpec && (r.planingSpec !== 'other' || !!r.planingOther.trim()));
    const cuttingDone = !r.cutting || !!r.cutLength.trim();
    return planingDone && cuttingDone;
  });
  const priceOk = lines.every((l) => (parseFloat(pr(l.key)) || 0) > 0);

  const stepValid: Record<StepKey, boolean> = {
    start: startOk,
    items: itemsOk,
    customer: headerOk,
    split: splitOk,
    reman: remanOk,
    price: priceOk,
    review: true,
  };
  const canCreate = startOk && itemsOk && headerOk && splitOk && remanOk && priceOk;

  const step = STEPS[stepIndex];
  const accent = mode === 'existing' ? '#D9822B' : ARCH_SURFACE.green;

  const buildDraft = (): ArchOrderDraft => ({
    mode,
    existingSO: mode === 'existing' ? existingSO : null,
    header: {
      customer,
      customerPO,
      shipTo,
      currency,
      shipDate,
      incoterms,
      salesTeam,
      paymentTerms: paymentTermsFor(customer),
    },
    lines: lines.map((l) => ({
      lotNo: l.lotNo,
      itemCode: l.itemCode,
      description: l.description,
      locationName: l.locationName,
      containerNo: l.containerNo,
      bf: orderedBF(l, sp(l.key)),
      lotBF: l.bf,
      costPerBF: l.costPerBF,
      pricePerBF: parseFloat(pr(l.key)) || 0,
      isSplit: sp(l.key).on,
      reman: rm(l.key),
    })),
    totals,
  });

  /* ── Step bodies ──────────────────────────────────────────────────────────*/

  const startBody = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <label style={label}>What would you like to do? *</label>
        <div style={{ display: 'flex', gap: 12 }}>
          {(
            [
              ['new', 'Create sales order', 'Start a fresh order from the selected lots'],
              ['existing', 'Add to existing sales order', 'Open an order and adjust its lines'],
            ] as [ArchOrderMode, string, string][]
          ).map(([m, title, sub]) => {
            const on = mode === m;
            const col = m === 'existing' ? '#D9822B' : ARCH_SURFACE.green;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  if (m === 'new') {
                    setExistingSO('');
                    setCustomer('');
                    setShipTo('');
                    setCurrency('');
                    setIncoterms('');
                    setSalesTeam('');
                  }
                }}
                style={{
                  flex: '1 1 0',
                  textAlign: 'left',
                  padding: 16,
                  borderRadius: 12,
                  cursor: 'pointer',
                  border: `1.5px solid ${on ? col : '#CBD5E1'}`,
                  background: on ? (m === 'existing' ? '#FBF1E5' : '#E8F5EF') : '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      background: on ? col : '#E2E8F0',
                      color: on ? '#fff' : ARCH_SURFACE.textMid,
                    }}
                  >
                    {m === 'new' ? '＋' : '✎'}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: on ? col : ARCH_SURFACE.text }}>
                    {title}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: ARCH_SURFACE.textMid, marginTop: 7, lineHeight: 1.4 }}>
                  {sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {mode === 'existing' && (
        <div>
          <label style={label}>Order to edit *</label>
          <input
            type="text"
            value={soSearch}
            placeholder="Search by customer or order number…"
            onChange={(e) => setSoSearch(e.target.value)}
            style={{ ...field(false), marginBottom: 10 }}
          />
          {(() => {
            const q = soSearch.trim().toLowerCase();
            const matches = openOrders.filter(
              (o) => o.customer.toLowerCase().includes(q) || o.soNo.toLowerCase().includes(q)
            );
            if (matches.length === 0) {
              return (
                <div
                  style={{
                    padding: '14px 12px',
                    fontSize: 12.5,
                    color: ARCH_SURFACE.textLight,
                    textAlign: 'center',
                    border: '1px dashed #CBD5E1',
                    borderRadius: 9,
                  }}
                >
                  No open orders match “{soSearch}”.
                </div>
              );
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {matches.map((o) => {
                  const sel = o.soNo === existingSO;
                  // Ready to Build means the warehouse has started — no more edits.
                  const locked = o.status === 'Ready to Build';
                  return (
                    <button
                      key={o.soNo}
                      type="button"
                      disabled={locked}
                      onClick={() => applyExistingOrder(o.soNo)}
                      title={locked ? 'Ready to Build — the warehouse is preparing this order, it can no longer be edited' : undefined}
                      style={{
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '11px 13px',
                        borderRadius: 10,
                        cursor: locked ? 'not-allowed' : 'pointer',
                        opacity: locked ? 0.55 : 1,
                        border: `1.5px solid ${sel ? ARCH_SURFACE.green : '#CBD5E1'}`,
                        background: sel ? '#E8F5EF' : '#fff',
                      }}
                    >
                      <span
                        className="font-mono"
                        style={{ fontWeight: 800, fontSize: 12.5, color: ARCH_SURFACE.navy, flex: '0 0 96px' }}
                      >
                        {o.soNo}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: ARCH_SURFACE.text }}>
                          {o.customer}
                        </span>
                        <span style={{ display: 'block', fontSize: 11, color: ARCH_SURFACE.textMid, marginTop: 1 }}>
                          {o.shipTo}
                        </span>
                      </span>
                      <span style={{ flex: '0 0 auto', textAlign: 'right' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 20,
                            background: locked ? '#E0F7FA' : '#FFF8E1',
                            color: locked ? '#00838F' : '#E65100',
                          }}
                        >
                          {o.status}
                        </span>
                        <span style={{ display: 'block', fontSize: 10.5, color: ARCH_SURFACE.textLight, marginTop: 3 }}>
                          {o.lines.length} lot{o.lines.length === 1 ? '' : 's'} · opened {o.created}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );

  const itemsBody = (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: ARCH_SURFACE.textMid, lineHeight: 1.5, flex: 1 }}>
          {mode === 'existing' && chosenOrder ? (
            <>
              Lines already on <strong>{chosenOrder.soNo}</strong> are marked{' '}
              <span style={{ color: '#B36B16', fontWeight: 700 }}>On order</span>. Add lots from the grid or
              remove lines, then continue.
            </>
          ) : (
            'These are the lots you selected on the grid. Remove any you do not want, or go back for more.'
          )}
        </div>
        <button
          type="button"
          onClick={onAddMoreItems}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 9,
            border: `1.5px solid ${ARCH_SURFACE.green}`,
            background: '#fff',
            color: ARCH_SURFACE.green,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span> Add item
        </button>
      </div>

      {alreadyOnOrder.length > 0 && (
        <div
          style={{
            padding: '9px 12px',
            borderRadius: 9,
            background: '#FBF1E5',
            border: '1px solid #D9822B',
            fontSize: 11.5,
            color: '#7A4100',
            marginBottom: 12,
          }}
        >
          {alreadyOnOrder.length} selected bundle{alreadyOnOrder.length === 1 ? '' : 's'} already on this order and
          not added again:{' '}
          <span className="font-mono">{alreadyOnOrder.map((l) => l.lotNo).join(', ')}</span>
        </div>
      )}

      {lines.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: ARCH_SURFACE.textLight, fontSize: 13 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>🛒</div>
          No lots selected yet — close and tick some bundles on the grid.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={th}>Location</th>
              <th style={th}>Item / Lot</th>
              <th style={{ ...th, textAlign: 'right' }}>Lot BF</th>
              <th style={{ ...th, textAlign: 'right' }}>Cost / BF</th>
              <th style={{ ...th, textAlign: 'center', width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td style={{ ...td, fontSize: 11.5, color: ARCH_SURFACE.textMid, whiteSpace: 'nowrap' }}>
                  {l.locationName}
                </td>
                <LotCell line={l} />
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {formatBF(l.bf)}
                </td>
                <td style={{ ...td, textAlign: 'right' }} className="font-mono">
                  {fmtMoney(l.costPerBF)}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {!l.existing && (
                    <button
                      type="button"
                      onClick={() => onRemoveLine(l.key)}
                      title="Remove this lot"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        background: '#fff',
                        color: '#B22222',
                        cursor: 'pointer',
                        fontSize: 13,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const customerBody = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <ProvisionalNote>
        The NetSuite field IDs behind these inputs have not been supplied yet, and not all of the fields
        exist on the SO record. Treat the set below as the shape we expect, not as final.
      </ProvisionalNote>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 320px' }}>
          <label style={label}>Customer *</label>
          <select value={customer} onChange={(e) => pickCustomer(e.target.value)} style={field(!!customer)}>
            <option value="">— Select customer —</option>
            {CUSTOMERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <label style={label}>Customer PO</label>
          <input
            type="text"
            value={customerPO}
            placeholder="Customer PO number…"
            onChange={(e) => setCustomerPO(e.target.value)}
            style={field(!!customerPO.trim())}
          />
        </div>
      </div>

      <div>
        <label style={label}>Ship-to address *</label>
        <select
          value={shipTo}
          disabled={!customer}
          onChange={(e) => setShipTo(e.target.value)}
          style={{ ...field(!!shipTo), cursor: customer ? 'pointer' : 'not-allowed', opacity: customer ? 1 : 0.6 }}
        >
          <option value="">{customer ? '— Select address —' : 'Select a customer first'}</option>
          {addressesFor(customer).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <label style={label}>Currency *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {currenciesFor(customer).map((c) => (
              <button
                key={c}
                type="button"
                disabled={!customer}
                onClick={() => setCurrency(c)}
                className="font-mono"
                style={{
                  padding: '9px 18px',
                  borderRadius: 9,
                  cursor: customer ? 'pointer' : 'not-allowed',
                  fontSize: 13,
                  fontWeight: 700,
                  border: `1.5px solid ${currency === c ? ARCH_SURFACE.green : '#CBD5E1'}`,
                  background: currency === c ? '#E8F5EF' : '#fff',
                  color: currency === c ? ARCH_SURFACE.green : ARCH_SURFACE.textMid,
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={label}>Ship date *</label>
          <input
            type="date"
            value={shipDate}
            onChange={(e) => setShipDate(e.target.value)}
            style={{ ...field(!!shipDate), cursor: 'pointer' }}
          />
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <label style={label}>Payment terms</label>
          <input
            type="text"
            value={customer ? paymentTermsFor(customer) : ''}
            placeholder="—"
            disabled
            readOnly
            title="From the customer record — display only"
            style={{ ...field(false), background: '#EEF1F6', color: ARCH_SURFACE.textMid, cursor: 'not-allowed' }}
          />
          <div style={{ fontSize: 10, color: ARCH_SURFACE.textLight, marginTop: 3 }}>
            From customer record — read-only
          </div>
        </div>
      </div>

      <div>
        <label style={label}>Incoterms *</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {INCOTERMS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setIncoterms(t)}
              style={{
                flex: '1 1 120px',
                padding: '11px 12px',
                borderRadius: 9,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                border: `1.5px solid ${incoterms === t ? ARCH_SURFACE.green : '#CBD5E1'}`,
                background: incoterms === t ? '#E8F5EF' : '#fff',
                color: incoterms === t ? ARCH_SURFACE.green : ARCH_SURFACE.textMid,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={label}>Sales team *</label>
        <select
          value={salesTeam}
          disabled={!customer}
          onChange={(e) => setSalesTeam(e.target.value)}
          style={{ ...field(!!salesTeam), cursor: customer ? 'pointer' : 'not-allowed', opacity: customer ? 1 : 0.6 }}
        >
          <option value="">{customer ? '— Select sales team —' : 'Select a customer first'}</option>
          {SALES_TEAM_NAMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {(SALES_TEAMS[salesTeam] || []).length > 0 && (
          <div style={{ marginTop: 8, border: '1px solid #E2E8F0', borderRadius: 9, overflow: 'hidden' }}>
            <div
              style={{
                padding: '6px 10px',
                background: '#F8FAFC',
                fontSize: 9.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                color: ARCH_SURFACE.textMid,
                borderBottom: '1px solid #E2E8F0',
              }}
            >
              Commission split
            </div>
            {SALES_TEAMS[salesTeam].map((m, i, arr) => (
              <div
                key={m.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 10px',
                  borderBottom: i < arr.length - 1 ? '1px solid #E2E8F0' : 'none',
                }}
              >
                <span style={{ fontSize: 12.5, color: ARCH_SURFACE.text, flex: '0 0 150px' }}>{m.name}</span>
                <div style={{ flex: 1, height: 7, borderRadius: 4, background: '#E2E8F0', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${m.pct}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${ARCH_SURFACE.green}, #237A52)`,
                    }}
                  />
                </div>
                <span
                  className="font-mono"
                  style={{ fontSize: 12, fontWeight: 700, color: ARCH_SURFACE.navy, flex: '0 0 42px', textAlign: 'right' }}
                >
                  {m.pct}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const splitBody = (
    <div>
      <ProvisionalNote>
        How a split line is marked on the sales order is <strong>not decided yet</strong> — custom record or
        checkbox. The wizard records the intent and the target quantity; it does not commit to a NetSuite
        representation. The <strong>${SPLIT_FEE} fee is a placeholder rate</strong>.
      </ProvisionalNote>
      <div style={{ fontSize: 12.5, color: ARCH_SURFACE.textMid, lineHeight: 1.5, marginBottom: 14 }}>
        The quantity you enter is a <strong>placeholder</strong>. The warehouse measures each plank and
        finishes the row it lands in, so the delivered figure comes back slightly different. The{' '}
        <strong>whole bundle stays held</strong> — unsellable by anyone — until the split is completed in the
        system.
      </div>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={th}>Location</th>
            <th style={th}>Item / Lot</th>
            <th style={{ ...th, textAlign: 'right' }}>Lot BF</th>
            <th style={{ ...th, textAlign: 'center' }}>Split</th>
            <th style={{ ...th, textAlign: 'right' }}>BF to pick</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const s = sp(l.key);
            const v = parseFloat(s.targetBF);
            const bad = s.on && (!(v > 0) || v > l.bf + 1e-9);
            return (
              <tr key={l.key}>
                <td style={{ ...td, fontSize: 11.5, color: ARCH_SURFACE.textMid, whiteSpace: 'nowrap' }}>
                  {l.locationName}
                </td>
                <LotCell line={l} />
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {formatBF(l.bf)}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={s.on}
                    onChange={(e) => setSp(l.key, { on: e.target.checked, targetBF: e.target.checked ? s.targetBF : '' })}
                    aria-label={`Split bundle ${l.lotNo}`}
                    style={{ width: 16, height: 16, accentColor: ARCH_SURFACE.green, cursor: 'pointer' }}
                  />
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <input
                    type="number"
                    value={s.targetBF}
                    disabled={!s.on}
                    min={1}
                    max={l.bf}
                    placeholder={formatBF(l.bf)}
                    onChange={(e) => setSp(l.key, { targetBF: e.target.value })}
                    className="font-mono"
                    style={{
                      ...numField,
                      borderColor: bad ? '#B22222' : s.on ? ARCH_SURFACE.green : '#CBD5E1',
                      background: s.on ? '#fff' : '#F1F5FA',
                      cursor: s.on ? 'text' : 'not-allowed',
                    }}
                  />
                </td>
                <td style={{ ...td, fontSize: 11.5 }}>
                  {!s.on ? (
                    <span style={{ color: ARCH_SURFACE.textLight }}>Full bundle</span>
                  ) : bad ? (
                    <span style={{ color: '#B22222', fontWeight: 600 }}>
                      {!(v > 0) ? 'Enter a quantity' : `Exceeds the ${formatBF(l.bf)} BF bundle`}
                    </span>
                  ) : (
                    <span style={{ color: '#B36B16', fontWeight: 600 }}>
                      Split · +{fmtMoney(SPLIT_FEE, currency || 'USD', 0)} · bundle held
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const remanBody = (
    <div>
      <ProvisionalNote>
        Where remanufacturing lives on the sales order is <strong>not decided yet</strong> — a line
        description or dedicated fields. The <strong>rates and the dressed-thickness options below are
        placeholders</strong>. Unlike Industriel reman, this creates no new SKU and no inventory adjustment:
        it is a service with a fee.
      </ProvisionalNote>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={th}>Item / Lot</th>
            <th style={{ ...th, textAlign: 'center' }}>Plane</th>
            <th style={th}>Dressed to</th>
            <th style={{ ...th, textAlign: 'center' }}>Cut</th>
            <th style={th}>Length</th>
            <th style={{ ...th, textAlign: 'right' }}>Service cost</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const r = rm(l.key);
            const e = economics[i];
            // Prefer the row's own thickness; fall back to the description
            // ("Sapele 6/4 KD") only for lines built before it was carried.
            const opts = planingOptions(l.thickness || l.description);
            return (
              <tr key={l.key}>
                <LotCell line={l} />
                <td style={{ ...td, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={r.planing}
                    onChange={(e2) => setRm(l.key, { planing: e2.target.checked, planingSpec: '', planingOther: '' })}
                    aria-label={`Plane ${l.lotNo}`}
                    style={{ width: 16, height: 16, accentColor: ARCH_SURFACE.green, cursor: 'pointer' }}
                  />
                </td>
                <td style={td}>
                  {r.planing ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        value={r.planingSpec}
                        onChange={(e2) => setRm(l.key, { planingSpec: e2.target.value })}
                        style={{ ...field(!!r.planingSpec), width: 'auto', padding: '6px 8px', fontSize: 12 }}
                      >
                        <option value="">— Select —</option>
                        {opts.map((o) => (
                          <option key={o} value={o}>
                            {o === 'other' ? 'Other…' : `${o}"`}
                          </option>
                        ))}
                      </select>
                      {r.planingSpec === 'other' && (
                        <input
                          type="text"
                          value={r.planingOther}
                          placeholder='e.g. 1-7/16"'
                          onChange={(e2) => setRm(l.key, { planingOther: e2.target.value })}
                          style={{ ...field(!!r.planingOther.trim()), width: 120, padding: '6px 8px', fontSize: 12 }}
                        />
                      )}
                    </div>
                  ) : (
                    <span style={{ color: ARCH_SURFACE.textLight, fontSize: 11.5 }}>—</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={r.cutting}
                    onChange={(e2) => setRm(l.key, { cutting: e2.target.checked, cutLength: '' })}
                    aria-label={`Cut ${l.lotNo}`}
                    style={{ width: 16, height: 16, accentColor: ARCH_SURFACE.green, cursor: 'pointer' }}
                  />
                </td>
                <td style={td}>
                  {r.cutting ? (
                    <select
                      value={r.cutLength}
                      onChange={(e2) => setRm(l.key, { cutLength: e2.target.value })}
                      style={{ ...field(!!r.cutLength), width: 'auto', padding: '6px 8px', fontSize: 12 }}
                    >
                      <option value="">— Select —</option>
                      {CUT_LENGTHS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: ARCH_SURFACE.textLight, fontSize: 11.5 }}>—</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right' }} className="font-mono">
                  {e.planingCost + e.cuttingCost > 0 ? (
                    fmtMoney(e.planingCost + e.cuttingCost, currency || 'USD')
                  ) : (
                    <span style={{ color: ARCH_SURFACE.textLight }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontSize: 11, color: ARCH_SURFACE.textLight }}>
        Planing {fmtMoney(PLANING_RATE)}/BF · Cutting {fmtMoney(CUT_RATE)}/BF — both provisional.
      </div>
    </div>
  );

  const priceBody = (
    <div>
      <ProvisionalNote>
        Profit is computed against the <strong>lot cost</strong>, which is real. The deductions are not:
        the split fee, planing and cutting rates, and the {(OPS_INSURANCE_RATE * 100).toFixed(1)}% operations
        &amp; insurance charge are all placeholders. <strong>Do not quote a customer from these margins.</strong>
      </ProvisionalNote>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={th}>Item / Lot</th>
            <th style={{ ...th, textAlign: 'right' }}>BF</th>
            <th style={{ ...th, textAlign: 'right' }}>Cost / BF</th>
            <th style={{ ...th, textAlign: 'right' }}>Price / BF *</th>
            <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
            <th style={{ ...th, textAlign: 'right' }}>Profit</th>
            <th style={{ ...th, textAlign: 'right' }}>Margin</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const e = economics[i];
            const entered = (parseFloat(pr(l.key)) || 0) > 0;
            return (
              <tr key={l.key}>
                <LotCell line={l} />
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {formatBF(e.bf)}
                </td>
                <td style={{ ...td, textAlign: 'right', color: ARCH_SURFACE.textMid }} className="font-mono">
                  {fmtMoney(l.costPerBF)}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={pr(l.key)}
                    placeholder="0.00"
                    onChange={(e2) => setPrice((m) => ({ ...m, [l.key]: e2.target.value }))}
                    className="font-mono"
                    style={{ ...numField, width: 96, borderColor: entered ? ARCH_SURFACE.green : '#CBD5E1' }}
                  />
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {entered ? fmtMoney(e.revenue, currency || 'USD', 0) : '—'}
                </td>
                <td
                  style={{ ...td, textAlign: 'right', fontWeight: 700, color: marginColor(e.marginPct) }}
                  className="font-mono"
                >
                  {entered ? fmtMoney(e.profit, currency || 'USD', 0) : '—'}
                </td>
                <td
                  style={{ ...td, textAlign: 'right', fontWeight: 700, color: marginColor(e.marginPct) }}
                  className="font-mono"
                >
                  {entered ? fmtPct(e.marginPct) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const reviewBody = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          padding: '14px 16px',
          borderRadius: 10,
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
        }}
      >
        {[
          ['Customer', customer || '—'],
          ['Customer PO', customerPO || '—'],
          ['Ship to', shipTo || '—'],
          ['Ship date', shipDate || '—'],
          ['Incoterms', incoterms || '—'],
          ['Currency', currency || '—'],
          ['Payment terms', paymentTermsFor(customer) || '—'],
          ['Sales team', salesTeam || '—'],
        ].map(([k, v]) => (
          <div key={k}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: ARCH_SURFACE.textLight,
                marginBottom: 3,
              }}
            >
              {k}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: ARCH_SURFACE.text }}>{v}</div>
          </div>
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={th}>Item / Lot</th>
            <th style={th}>Services</th>
            <th style={{ ...th, textAlign: 'right' }}>BF</th>
            <th style={{ ...th, textAlign: 'right' }}>Price / BF</th>
            <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
            <th style={{ ...th, textAlign: 'right' }}>Profit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const e = economics[i];
            const s = sp(l.key);
            const r = rm(l.key);
            const badges: React.ReactNode[] = [];
            if (s.on)
              badges.push(
                <span
                  key="s"
                  style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: '#FFF8E1', color: '#B36B16', marginRight: 4 }}
                >
                  Split
                </span>
              );
            if (r.planing)
              badges.push(
                <span
                  key="p"
                  style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: '#EEF2FB', color: ARCH_SURFACE.navyMid, marginRight: 4 }}
                >
                  Plane → {r.planingSpec === 'other' ? r.planingOther : `${r.planingSpec}"`}
                </span>
              );
            if (r.cutting)
              badges.push(
                <span
                  key="c"
                  style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: '#FBF1E5', color: '#B36B16' }}
                >
                  Cut → {r.cutLength}
                </span>
              );
            return (
              <tr key={l.key}>
                <LotCell line={l} />
                <td style={td}>{badges.length ? badges : <span style={{ color: ARCH_SURFACE.textLight }}>—</span>}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {formatBF(e.bf)}
                </td>
                <td style={{ ...td, textAlign: 'right' }} className="font-mono">
                  {fmtMoney(parseFloat(pr(l.key)) || 0)}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {fmtMoney(e.revenue, currency || 'USD', 0)}
                </td>
                <td
                  style={{ ...td, textAlign: 'right', fontWeight: 700, color: marginColor(e.marginPct) }}
                  className="font-mono"
                >
                  {fmtMoney(e.profit, currency || 'USD', 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div
        style={{
          display: 'flex',
          gap: 24,
          flexWrap: 'wrap',
          padding: '14px 18px',
          borderRadius: 10,
          background: 'linear-gradient(135deg, #0F2641, #1A3D63)',
          color: '#fff',
        }}
      >
        {[
          ['Board feet', `${formatBF(totals.bf)} BF`, '#fff'],
          ['Revenue', fmtMoney(totals.revenue, currency || 'USD', 0), '#fff'],
          ['Lot cost', fmtMoney(totals.lotCost, currency || 'USD', 0), 'rgba(255,255,255,0.75)'],
          ['Services + ops', fmtMoney(totals.processingCost + totals.opsInsuranceCost, currency || 'USD', 0), 'rgba(255,255,255,0.75)'],
          ['Estimated profit', fmtMoney(totals.profit, currency || 'USD', 0), totals.profit < 0 ? '#FCA5A5' : '#A5D6A7'],
          ['Margin', fmtPct(totals.marginPct), totals.marginPct < 0 ? '#FCA5A5' : '#A5D6A7'],
        ].map(([k, v, col]) => (
          <div key={k}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: 'rgba(255,255,255,0.45)',
                marginBottom: 3,
              }}
            >
              {k}
            </div>
            <div className="font-mono" style={{ fontSize: 16, fontWeight: 700, color: col }}>
              {v}
            </div>
          </div>
        ))}
      </div>

      <ProvisionalNote>
        <strong>Create does not write to NetSuite yet.</strong> It assembles the order and hands it back for
        inspection. Persistence is blocked on the split marker, the reman fields, the real rates and the SO
        header field IDs.
      </ProvisionalNote>
    </div>
  );

  const bodies: Record<StepKey, React.ReactNode> = {
    start: startBody,
    items: itemsBody,
    customer: customerBody,
    split: splitBody,
    reman: remanBody,
    price: priceBody,
    review: reviewBody,
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[1180px] w-[96vw] p-0 gap-0 overflow-hidden"
        style={{ height: '88vh', display: 'flex', flexDirection: 'column' }}
        aria-describedby={undefined}
        aria-label="Sales order builder"
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #0F2641, #1A3D63)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: '#E8F5E9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}
            >
              📋
            </div>
            <div>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
                {mode === 'existing' ? 'Add to sales order' : 'Create sales order'}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, marginTop: 1 }}>
                {mode === 'existing' && existingSO ? `Editing ${existingSO}` : `${lines.length} lot${lines.length === 1 ? '' : 's'} selected`}
              </div>
            </div>
          </div>
        </div>

        {/* Step rail */}
        <div style={{ display: 'flex', background: 'var(--navy-mid)', flexShrink: 0, padding: '0 8px' }}>
          {STEPS.map((s, i) => {
            const on = i === stepIndex;
            const done = i < stepIndex;
            return (
              <button
                key={s.key}
                type="button"
                // Only allow jumping back, so a later step can't be reached with
                // an invalid earlier one.
                onClick={() => i < stepIndex && setStepIndex(i)}
                style={{
                  flex: 1,
                  padding: '9px 6px',
                  border: 'none',
                  cursor: i < stepIndex ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  background: on ? 'var(--navy)' : 'transparent',
                  color: on ? '#fff' : done ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.4)',
                  fontSize: 12,
                  fontWeight: on ? 700 : 600,
                  borderBottom: on ? `3px solid ${accent}` : '3px solid transparent',
                }}
              >
                <span
                  style={{
                    width: 17,
                    height: 17,
                    borderRadius: '50%',
                    fontSize: 9.5,
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: on ? accent : done ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
                    color: '#fff',
                  }}
                >
                  {done ? '✓' : i + 1}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', background: '#fff' }}>
          {bodies[step.key]}
        </div>

        {/* Footer */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderTop: '1px solid #E2E8F0',
            background: '#F8FAFC',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 18px',
              borderRadius: 9,
              border: '1.5px solid #CBD5E1',
              background: '#fff',
              color: ARCH_SURFACE.textMid,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {!stepValid[step.key] && (
              <span style={{ fontSize: 11.5, color: '#B36B16' }}>
                {step.key === 'items'
                  ? 'Add at least one lot'
                  : step.key === 'customer'
                    ? 'Complete the required fields'
                    : step.key === 'split'
                      ? 'Fix the split quantities'
                      : step.key === 'reman'
                        ? 'Complete the service details'
                        : step.key === 'price'
                          ? 'Enter a price for every line'
                          : 'Select an order'}
              </span>
            )}
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => i - 1)}
                style={{
                  padding: '9px 18px',
                  borderRadius: 9,
                  border: '1.5px solid #CBD5E1',
                  background: '#fff',
                  color: ARCH_SURFACE.textMid,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            {step.key !== 'review' ? (
              <button
                type="button"
                disabled={!stepValid[step.key]}
                onClick={() => setStepIndex((i) => i + 1)}
                style={{
                  padding: '9px 22px',
                  borderRadius: 9,
                  border: 'none',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: stepValid[step.key] ? 'pointer' : 'not-allowed',
                  background: stepValid[step.key] ? accent : '#CBD5E1',
                  color: stepValid[step.key] ? '#fff' : '#94A3B8',
                }}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={!canCreate}
                onClick={() => onCreate(buildDraft())}
                style={{
                  padding: '9px 24px',
                  borderRadius: 9,
                  border: 'none',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: canCreate ? 'pointer' : 'not-allowed',
                  background: canCreate ? accent : '#CBD5E1',
                  color: canCreate ? '#fff' : '#94A3B8',
                }}
              >
                {mode === 'existing' ? 'Update order' : 'Create sales order'}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
