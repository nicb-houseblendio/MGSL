import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatQty, unitLabel, formatUnitTotals } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import {
  SPLIT_FEE_PLACEHOLDER,
  splitFee,
  splitFeeEnabled,
  PLANING_RATE,
  CUT_RATE,
  opsInsuranceRate,
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

/**
 * Bulk dressing choices, in the order planingOptions emits them: it maps
 * [nominal x 0.96, x 0.875, x 0.80] to fractions, so index 0 is the lightest
 * pass. Labelled by depth of cut rather than by a fraction because the
 * resulting size differs per lot — 4/4 dresses to 15/16, 8/4 to 1-15/16.
 */
const BULK_PLANING_LEVELS = ['Light (≈4% off)', 'Standard (≈12.5% off)', 'Heavy (≈20% off)'];

/**
 * 🔴 PLACEHOLDER, like every other rate here. Flags a sell price under
 * cost x this. The real trigger — customer floor, deal type, currency — has not
 * been specified, so this warns and never blocks.
 */
const LOW_PRICE_TRIGGER = 1.1;

/**
 * Edit-mode accent. Orange separates "adding to an existing order" from the
 * green of "creating a new one", which is worth keeping — it is the only
 * persistent signal that you are editing someone's live order.
 *
 * Was #D9822B, the prototype's value. White on it measures 2.93:1, so in edit
 * mode the primary Continue button and the active step badge — the two things
 * you look at most — both failed AA, while the same controls pass at ~5.5 in
 * create mode because that accent is the darker green. #A85D14 is the same
 * orange, dark enough to carry white at 4.95:1.
 */
const EDIT_ACCENT = '#A85D14';

/**
 * Amber used for text and badges on light surfaces — the On order badge, the
 * split/held status, the footer validation hint. #B36B16 measured 3.7-4.2:1
 * depending on the tint behind it, so every one of them sat under AA. Same
 * amber, dark enough to clear it on white and on the #FFF8E1 / #FBF1E5 chips.
 */
const AMBER_TEXT = '#8F5612';

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
            color: AMBER_TEXT,
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

  /**
   * "Apply to all" settings for the Remanufacturing step. Held separately from
   * `reman` so nothing changes until the trader presses Apply.
   *
   * `planingLevel` is an INDEX into the lot's own dressing options, not a fixed
   * fraction. The prototype's bulk bar offers a hard-coded 4/4 list
   * (3/4, 13/16, 7/8, 15/16) and writes the chosen string onto every line
   * verbatim — so bulk-dressing a mixed cart puts "15/16" on 8/4 stock, whose
   * dressed size is about 1-15/16. Its own `dressedSizeFor(desc, frac)` was
   * meant to resolve that and is stubbed to the identity function, flagged
   * "pending real values". Applying a level instead lets each line resolve
   * through planingOptions, which already does the per-lot maths.
   */
  const [bulkReman, setBulkReman] = React.useState({
    planing: false,
    planingLevel: '',
    cutting: false,
    cutLength: '',
  });

  /**
   * Ship-to addresses typed in on this order, keyed by customer. Kept in wizard
   * state only: writing to the customer record is a NetSuite write, and this
   * wizard still writes nothing.
   */
  const [extraAddresses, setExtraAddresses] = React.useState<Record<string, string[]>>({});
  const [addingAddress, setAddingAddress] = React.useState(false);
  const [newAddress, setNewAddress] = React.useState({ name: '', street: '', city: '' });

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
  /**
   * Lines of the chosen order the trader has dropped on the Items step. Held
   * separately from `cart` because they never came from the cart — the cart is
   * bundles picked off the grid, these arrive with the order.
   */
  const [droppedExisting, setDroppedExisting] = React.useState<Set<string>>(() => new Set());

  /**
   * The order's lines that survive after drops. Everything downstream keys off
   * this, NOT off chosenOrder.lines.
   *
   * The distinction matters: the duplicate guard used the order's ORIGINAL
   * lines, so dropping a line the trader also had in their cart made that
   * bundle disappear from the order entirely — the order's copy was dropped
   * and the cart's copy stayed suppressed as "already on this order", which by
   * then was false. Dropping once cost it twice, and the notice kept insisting
   * the bundle was on an order it had just been taken off.
   */
  const keptExisting = React.useMemo(
    () => (chosenOrder ? chosenOrder.lines.filter((l) => !droppedExisting.has(l.key)) : []),
    [chosenOrder, droppedExisting]
  );

  const lines = React.useMemo<ArchCartLine[]>(() => {
    if (mode !== 'existing' || !chosenOrder) return cart;
    const onOrder = new Set(keptExisting.map(bundleId));
    return [...keptExisting, ...cart.filter((l) => !onOrder.has(bundleId(l)))];
  }, [mode, chosenOrder, cart, keptExisting]);

  /** Dropping is per-order, so switching orders must not carry the set over. */
  React.useEffect(() => {
    setDroppedExisting(new Set());
  }, [existingSO]);

  /** Cart lots skipped because the order STILL has them — surfaced on Items. */
  const alreadyOnOrder = React.useMemo(() => {
    if (mode !== 'existing' || !chosenOrder) return [];
    const onOrder = new Set(keptExisting.map(bundleId));
    return cart.filter((l) => onOrder.has(bundleId(l)));
  }, [mode, chosenOrder, cart, keptExisting]);

  const sp = (k: string) => split[k] || emptySplit();
  const rm = (k: string) => reman[k] || emptyReman();
  const pr = (k: string) => price[k] ?? '';

  const setSp = (k: string, patch: Partial<ArchSplitIntent>) =>
    setSplit((m) => ({ ...m, [k]: { ...sp(k), ...patch } }));
  const setRm = (k: string, patch: Partial<ArchRemanIntent>) =>
    setReman((m) => ({ ...m, [k]: { ...rm(k), ...patch } }));

  const allAddresses = React.useMemo(
    () => [...addressesFor(customer), ...(extraAddresses[customer] || [])],
    [customer, extraAddresses]
  );

  const newAddressComplete =
    !!newAddress.name.trim() && !!newAddress.street.trim() && !!newAddress.city.trim();

  /** Priced, but under the trigger. Warns only — pricing is never blocked on it. */
  const isLowPriced = (l: ArchCartLine) => {
    const p = parseFloat(pr(l.key)) || 0;
    return p > 0 && p < (l.costPerBF || 0) * LOW_PRICE_TRIGGER;
  };
  const lowPricedLines = lines.filter(isLowPriced);

  /** Push the bulk settings onto every line, resolving the dressing per lot. */
  const applyBulkReman = () => {
    setReman((prev) => {
      const next = { ...prev };
      lines.forEach((l) => {
        const current = next[l.key] || emptyReman();
        const opts = planingOptions(l.thickness || l.description);
        const idx = parseInt(bulkReman.planingLevel, 10);
        // 'other' carries no size of its own, so it cannot be applied in bulk —
        // leave whatever the line already had rather than blanking it.
        const spec =
          bulkReman.planing && Number.isFinite(idx) && opts[idx] && opts[idx] !== 'other'
            ? opts[idx]
            : bulkReman.planing
              ? current.planingSpec
              : '';
        next[l.key] = {
          ...current,
          planing: bulkReman.planing,
          planingSpec: spec,
          planingOther: bulkReman.planing ? current.planingOther : '',
          cutting: bulkReman.cutting,
          cutLength: bulkReman.cutting ? bulkReman.cutLength : '',
        };
      });
      return next;
    });
  };

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
  const accent = mode === 'existing' ? EDIT_ACCENT : ARCH_SURFACE.green;

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
      unit: l.unit,
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
            const col = m === 'existing' ? EDIT_ACCENT : ARCH_SURFACE.green;
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
              <span style={{ color: AMBER_TEXT, fontWeight: 700 }}>On order</span>. Add lots from the grid or
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
            border: `1px solid ${EDIT_ACCENT}`,
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
                  {formatQty(l.bf, l.unit)}
                </td>
                <td style={{ ...td, textAlign: 'right' }} className="font-mono">
                  {l.costPerBF === null ? '—' : fmtMoney(l.costPerBF)}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {(
                    <button
                      type="button"
                      onClick={() =>
                        l.existing
                          ? setDroppedExisting((s) => new Set(s).add(l.key))
                          : onRemoveLine(l.key)
                      }
                      title={l.existing ? `Drop this line from ${existingSO}` : 'Remove this lot'}
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
          {/* Totals, as the prototype has. Without it the trader has to add the
              rows up to know what the order now carries after adding or dropping. */}
          <tfoot>
            <tr style={{ background: '#F1F5FA' }}>
              <td
                colSpan={2}
                style={{
                  ...td,
                  fontWeight: 700,
                  fontSize: 10.5,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  color: ARCH_SURFACE.textMid,
                  borderTop: '2px solid #CBD5E1',
                }}
              >
                {lines.length} lot{lines.length === 1 ? '' : 's'} ·{' '}
                {new Set(lines.map((l) => l.itemCode)).size} item
                {new Set(lines.map((l) => l.itemCode)).size === 1 ? '' : 's'}
              </td>
              <td
                style={{
                  ...td,
                  textAlign: 'right',
                  fontWeight: 800,
                  color: ARCH_SURFACE.navy,
                  borderTop: '2px solid #CBD5E1',
                }}
                className="font-mono"
              >
                {formatUnitTotals(lines.map((l) => ({ unit: l.unit, qty: l.bf })))}
              </td>
              <td style={{ ...td, borderTop: '2px solid #CBD5E1' }} />
              <td style={{ ...td, borderTop: '2px solid #CBD5E1' }} />
            </tr>
          </tfoot>
        </table>
      )}

      {droppedExisting.size > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: '9px 12px',
            borderRadius: 9,
            background: '#FBF1E5',
            border: `1px solid ${EDIT_ACCENT}`,
            fontSize: 11.5,
            color: '#7A4100',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>
            {droppedExisting.size} line{droppedExisting.size === 1 ? '' : 's'} dropped from{' '}
            {existingSO}. Nothing is removed in NetSuite — this records the intent only.
          </span>
          {/* Dropping an order's own line is destructive-looking and there is no
              other way back short of restarting the wizard. */}
          <button
            type="button"
            onClick={() => setDroppedExisting(new Set())}
            style={{
              flexShrink: 0,
              padding: '5px 11px',
              borderRadius: 7,
              border: `1px solid ${EDIT_ACCENT}`,
              background: '#fff',
              color: '#7A4100',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Undo
          </button>
        </div>
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
          {/*
            LOCKED when editing an existing order. It was a live dropdown, so a
            trader could reassign SO-41468 from Atlas Millwork to someone else —
            which this wizard cannot do and would never mean to. The prototype
            renders it read-only in this mode for the same reason, and the Review
            step says outright that customer and terms come from the order.
          */}
          {mode === 'existing' ? (
            <div
              style={{
                ...field(true),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                background: '#F8FAFC',
              }}
            >
              <span style={{ fontWeight: 600 }}>{customer || '—'}</span>
              <span style={{ fontSize: 11, color: ARCH_SURFACE.textMid, whiteSpace: 'nowrap' }}>
                from {existingSO}
              </span>
            </div>
          ) : (
            <select value={customer} onChange={(e) => pickCustomer(e.target.value)} style={field(!!customer)}>
              <option value="">— Select customer —</option>
              {CUSTOMERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
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
        {!addingAddress ? (
          <select
            value={shipTo}
            disabled={!customer}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setAddingAddress(true);
                setShipTo('');
              } else setShipTo(e.target.value);
            }}
            style={{ ...field(!!shipTo), cursor: customer ? 'pointer' : 'not-allowed', opacity: customer ? 1 : 0.6 }}
          >
            <option value="">{customer ? '— Select address —' : 'Select a customer first'}</option>
            {allAddresses.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            {customer && <option value="__new__">＋ Add new ship-to address…</option>}
          </select>
        ) : (
          <div
            style={{
              border: `1.5px solid ${ARCH_SURFACE.green}`,
              borderRadius: 10,
              padding: '12px 14px',
              background: '#F8FAFC',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: ARCH_SURFACE.text, marginBottom: 10 }}>
              New ship-to address
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="text"
                value={newAddress.name}
                placeholder="Location name (e.g. Main Yard)"
                onChange={(e) => setNewAddress((a) => ({ ...a, name: e.target.value }))}
                style={field(!!newAddress.name.trim())}
              />
              <input
                type="text"
                value={newAddress.street}
                placeholder="Street address"
                onChange={(e) => setNewAddress((a) => ({ ...a, street: e.target.value }))}
                style={field(!!newAddress.street.trim())}
              />
              <input
                type="text"
                value={newAddress.city}
                placeholder="City, Province"
                onChange={(e) => setNewAddress((a) => ({ ...a, city: e.target.value }))}
                style={field(!!newAddress.city.trim())}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setAddingAddress(false);
                  setNewAddress({ name: '', street: '', city: '' });
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1.5px solid #CBD5E1',
                  background: '#fff',
                  color: ARCH_SURFACE.textMid,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newAddressComplete}
                onClick={() => {
                  const full = `${newAddress.name.trim()} — ${newAddress.street.trim()}, ${newAddress.city.trim()}`;
                  setExtraAddresses((m) => ({ ...m, [customer]: [...(m[customer] || []), full] }));
                  setShipTo(full);
                  setAddingAddress(false);
                  setNewAddress({ name: '', street: '', city: '' });
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: newAddressComplete ? ARCH_SURFACE.green : '#CBD5E1',
                  color: '#fff',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: newAddressComplete ? 'pointer' : 'not-allowed',
                }}
              >
                Save address
              </button>
            </div>
            <div style={{ fontSize: 11, color: ARCH_SURFACE.textMid, marginTop: 8, lineHeight: 1.4 }}>
              Held on this order only. Nothing is written to the customer record until SO creation is
              wired up.
            </div>
          </div>
        )}
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
          {/* The prototype says this, and it is worth saying: with one button
              showing, a trader cannot tell whether the customer is USD-only or
              the screen simply has not loaded their currencies. */}
          {customer && (
            <div style={{ fontSize: 11, color: ARCH_SURFACE.textMid, marginTop: 6 }}>
              {currenciesFor(customer).length > 1
                ? `This customer can be billed in ${currenciesFor(customer).join(' or ')}.`
                : `This customer is billed in ${currenciesFor(customer)[0]} only.`}
            </div>
          )}
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
        representation.{' '}
        {splitFeeEnabled()
          ? <strong>The ${splitFee()} split fee comes from configuration.</strong>
          : <strong>No split fee is charged — the ${SPLIT_FEE_PLACEHOLDER} in the prototype was never confirmed, so it stays off.</strong>}
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
                  {formatQty(l.bf, l.unit)}
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
                    /*
                      step="any" and min 0, not min 1 with an implied step of 1.
                      Board feet in hardwood are genuinely fractional — a bundle
                      re-tallied after the saw comes back 1,732.5, not 1,733 —
                      and with no step declared the browser defaults to 1 and
                      marks every decimal stepMismatch. 100.5 was reported valid
                      by our own check, drawn with a green border, and allowed
                      past Continue, while the input was :invalid to the browser
                      and would raise a native "nearest valid values are..."
                      bubble. Our own >0 check still rejects 0 and negatives.
                    */
                    min={0}
                    step="any"
                    max={l.bf}
                    placeholder={formatQty(l.bf, l.unit)}
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
                {/* Status colours: #8F5612 for the held/fee line, matching the
                    footer hint. #B36B16 measured 4.17:1 here and this is what
                    tells the trader the bundle goes on hold and the fee bites. */}
                <td style={{ ...td, fontSize: 11.5 }}>
                  {!s.on ? (
                    <span style={{ color: ARCH_SURFACE.textLight }}>Full bundle</span>
                  ) : bad ? (
                    <span style={{ color: '#B22222', fontWeight: 600 }}>
                      {!(v > 0) ? 'Enter a quantity' : `Exceeds the ${formatQty(l.bf, l.unit)} ${unitLabel(l.unit)} bundle`}
                    </span>
                  ) : (
                    <span style={{ color: AMBER_TEXT, fontWeight: 600 }}>
                      Split{splitFeeEnabled() ? ' · +' + fmtMoney(splitFee(), currency || 'USD', 0) : ''} · bundle held
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
      {lines.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: 9,
            padding: '10px 12px',
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              color: ARCH_SURFACE.textMid,
            }}
          >
            Apply to all
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={bulkReman.planing}
              onChange={(e2) =>
                setBulkReman((b) => ({ ...b, planing: e2.target.checked, planingLevel: '' }))
              }
              style={{ width: 16, height: 16, accentColor: ARCH_SURFACE.green, cursor: 'pointer' }}
            />
            Plane
          </label>
          {bulkReman.planing && (
            <select
              value={bulkReman.planingLevel}
              onChange={(e2) => setBulkReman((b) => ({ ...b, planingLevel: e2.target.value }))}
              style={{
                ...numField,
                width: 190,
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: bulkReman.planingLevel ? ARCH_SURFACE.green : '#CBD5E1',
              }}
            >
              <option value="">Dressing level…</option>
              {BULK_PLANING_LEVELS.map((lvl, i) => (
                <option key={lvl} value={String(i)}>
                  {lvl}
                </option>
              ))}
            </select>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={bulkReman.cutting}
              onChange={(e2) => setBulkReman((b) => ({ ...b, cutting: e2.target.checked, cutLength: '' }))}
              style={{ width: 16, height: 16, accentColor: ARCH_SURFACE.green, cursor: 'pointer' }}
            />
            Cut
          </label>
          {/*
            The SAME select the lines use, not a free-text box.
            It was a text input, and the per-line control is a dropdown of
            standard lengths, so bulk-applying anything outside that list —
            "9 ft", say — wrote a value the line could not render: every Length
            cell fell back to "— Select —" while Cut stayed ticked, the service
            cost included the cutting rate, and Continue was enabled because the
            stored string was non-empty. The trader saw four unset dropdowns and
            an order that nonetheless carried a length they never chose.
            Sharing the option list makes that state unreachable.
          */}
          <select
            value={bulkReman.cutLength}
            disabled={!bulkReman.cutting}
            onChange={(e2) => setBulkReman((b) => ({ ...b, cutLength: e2.target.value }))}
            style={{
              ...numField,
              width: 140,
              textAlign: 'left',
              cursor: bulkReman.cutting ? 'pointer' : 'not-allowed',
              opacity: bulkReman.cutting ? 1 : 0.45,
              borderColor: bulkReman.cutLength ? ARCH_SURFACE.green : '#CBD5E1',
            }}
          >
            <option value="">Target length…</option>
            {CUT_LENGTHS.map((len) => (
              <option key={len} value={len}>
                {len}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyBulkReman}
            // Pressing Apply with nothing ticked would silently CLEAR every line,
            // which is destructive and looks like a no-op until you scroll down.
            disabled={!bulkReman.planing && !bulkReman.cutting}
            style={{
              marginLeft: 'auto',
              padding: '7px 14px',
              borderRadius: 7,
              border: `1px solid ${!bulkReman.planing && !bulkReman.cutting ? '#CBD5E1' : ARCH_SURFACE.navyMid}`,
              background: '#fff',
              color: !bulkReman.planing && !bulkReman.cutting ? '#94A3B8' : ARCH_SURFACE.navyMid,
              fontWeight: 600,
              fontSize: 12,
              cursor: !bulkReman.planing && !bulkReman.cutting ? 'not-allowed' : 'pointer',
            }}
          >
            Apply
          </button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            {/* Location, as on Bundle split, Pricing and Review. The reman is
                done at the yard holding the wood, so which yard is part of
                deciding whether to offer it. */}
            <th style={th}>Location</th>
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
                <td style={{ ...td, fontSize: 11.5, color: ARCH_SURFACE.textMid, whiteSpace: 'nowrap' }}>
                  {l.locationName}
                </td>
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
        Profit is computed against the <strong>lot cost</strong>, which is real, and the{' '}
        {(opsInsuranceRate() * 100).toFixed(2)}% operations &amp; insurance charge, which is the rate
        NetSuite already carries on the SO. Still provisional: the split fee and the planing and
        cutting rates. <strong>Do not quote a customer from these margins.</strong>
      </ProvisionalNote>
      {lowPricedLines.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '11px 14px',
            borderRadius: 9,
            border: '1px solid #FDE68A',
            background: '#FEF9C3',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <div style={{ flex: 1, fontSize: 12.5, color: '#713F12', lineHeight: 1.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                Pricing check — {lowPricedLines.length} line{lowPricedLines.length !== 1 ? 's' : ''} under
                trigger
              </span>
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontSize: 9.5,
                  fontWeight: 800,
                  background: '#92400E',
                  color: '#fff',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                placeholder logic — TBD
              </span>
            </div>
            Sell price is below <strong>cost + {((LOW_PRICE_TRIGGER - 1) * 100).toFixed(0)}%</strong> on the
            highlighted rows. The real trigger conditions (customer floor, deal type, currency) are not
            decided yet, and this warns only — it does not block.
          </div>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            {/* Location, as the prototype's pricing table has. Price per BF is
                not location-blind — incoterms and freight differ between CWP
                Prevost, Buffalo and North Carolina, and an order can draw from
                all three at once. */}
            <th style={th}>Location</th>
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
              <tr key={l.key} style={isLowPriced(l) ? { background: '#FFFBEB' } : undefined}>
                <td style={{ ...td, fontSize: 11.5, color: ARCH_SURFACE.textMid, whiteSpace: 'nowrap' }}>
                  {l.locationName}
                </td>
                <LotCell line={l} />
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {formatQty(e.bf, l.unit)}
                </td>
                <td style={{ ...td, textAlign: 'right', color: ARCH_SURFACE.textMid }} className="font-mono">
                  {l.costPerBF === null ? '—' : fmtMoney(l.costPerBF)}
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
        {/* Order total, as the prototype has. Pricing is where the trader decides
            whether the deal is worth doing, and that decision is about the ORDER,
            not one line at a time. */}
        <tfoot>
          <tr style={{ background: '#F1F5FA' }}>
            {/* colSpan 2 — Location plus Item/Lot — so the BF total stays under
                the BF column now that Location leads the table. */}
            <td
              colSpan={2}
              style={{
                ...td,
                fontWeight: 700,
                fontSize: 10.5,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                color: ARCH_SURFACE.textMid,
                borderTop: '2px solid #CBD5E1',
              }}
            >
              Order total
            </td>
            <td
              style={{ ...td, textAlign: 'right', fontWeight: 800, color: ARCH_SURFACE.navy, borderTop: '2px solid #CBD5E1' }}
              className="font-mono"
            >
              {formatUnitTotals(lines.map((l) => ({ unit: l.unit, qty: l.bf })))}
            </td>
            <td style={{ ...td, borderTop: '2px solid #CBD5E1' }} />
            <td style={{ ...td, borderTop: '2px solid #CBD5E1' }} />
            {/*
              Gated on priceOk, the same condition the footer states as "enter a
              price for every line". Ungated, a fresh order — where prices start
              empty — totalled revenue 0 against real lot cost and services and
              announced a -$8,817 loss at 0.0% margin, in red, before the trader
              had typed anything. The per-line cells already showed "—" for this,
              so the total was the only thing claiming a number it did not have.
              Board feet stays visible: it is true regardless of pricing.
            */}
            {priceOk ? (
              <>
                <td
                  style={{ ...td, textAlign: 'right', fontWeight: 800, borderTop: '2px solid #CBD5E1' }}
                  className="font-mono"
                >
                  {fmtMoney(totals.revenue, currency || 'USD', 0)}
                </td>
                <td
                  style={{
                    ...td,
                    textAlign: 'right',
                    fontWeight: 800,
                    color: marginColor(totals.marginPct),
                    borderTop: '2px solid #CBD5E1',
                  }}
                  className="font-mono"
                >
                  {fmtMoney(totals.profit, currency || 'USD', 0)}
                </td>
                <td
                  style={{
                    ...td,
                    textAlign: 'right',
                    fontWeight: 800,
                    color: marginColor(totals.marginPct),
                    borderTop: '2px solid #CBD5E1',
                  }}
                  className="font-mono"
                >
                  {fmtPct(totals.marginPct)}
                </td>
              </>
            ) : (
              <td
                colSpan={3}
                style={{
                  ...td,
                  textAlign: 'right',
                  fontSize: 11,
                  fontStyle: 'italic',
                  color: ARCH_SURFACE.textLight,
                  borderTop: '2px solid #CBD5E1',
                }}
              >
                Totals appear once every line is priced
              </td>
            )}
          </tr>
        </tfoot>
      </table>

      {/* The prototype spells the arithmetic out here. Worth keeping: the margin
          is the number the trader is judged on, and three of its four inputs are
          placeholder rates, so it has to be auditable rather than a black box. */}
      <div
        style={{
          marginTop: 14,
          padding: '11px 14px',
          borderRadius: 9,
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          fontSize: 11.5,
          color: ARCH_SURFACE.textMid,
          lineHeight: 1.6,
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: ARCH_SURFACE.text,
            marginBottom: 4,
          }}
        >
          How profit is calculated
        </div>
        Profit = Revenue − Lot cost − Services − Operations &amp; insurance.
        <br />
        Revenue = BF × price/BF · Lot cost = BF × cost/BF · Services = ${splitFeeEnabled() ? splitFee() : 0} per split lot + $
        {PLANING_RATE.toFixed(2)}/BF planing + ${CUT_RATE.toFixed(2)}/BF cutting ·
        Operations &amp; insurance = {(opsInsuranceRate() * 100).toFixed(2)}% of lot cost ·
        Margin % = Profit ÷ Revenue
      </div>
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
                // textMid, not textLight. Every other label in this wizard uses
                // textMid; Review was the only step on textLight, which is 3.19:1
                // on this panel — under the 4.5 needed at this size, and the
                // labels here are the hardest to read in the whole flow despite
                // being on the last screen before the order is committed.
                color: ARCH_SURFACE.textMid,
                marginBottom: 3,
              }}
            >
              {k}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: ARCH_SURFACE.text }}>{v}</div>
            {/* The prototype carries the commission split through to Review.
                It is decided on the Customer step and never restated, so this
                was the one place the trader could not check it before creating. */}
            {k === 'Sales team' && (SALES_TEAMS[salesTeam] || []).length > 0 && (
              <div style={{ fontSize: 10, color: ARCH_SURFACE.textMid, marginTop: 2 }}>
                {SALES_TEAMS[salesTeam].map((mem) => `${mem.name} ${mem.pct}%`).join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            {/* Location, as the prototype's Review has. An order can draw from
                CWP Prevost, Buffalo and North Carolina at once, and this was the
                only step that never said where a line ships from. */}
            <th style={th}>Location</th>
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
                  style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: '#FFF8E1', color: AMBER_TEXT, marginRight: 4 }}
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
                  style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 600, background: '#FBF1E5', color: AMBER_TEXT }}
                >
                  Cut → {r.cutLength}
                </span>
              );
            return (
              <tr key={l.key}>
                <td style={{ ...td, fontSize: 11.5, color: ARCH_SURFACE.textMid, whiteSpace: 'nowrap' }}>
                  {l.locationName}
                </td>
                <LotCell line={l} />
                <td style={td}>{badges.length ? badges : <span style={{ color: ARCH_SURFACE.textLight }}>—</span>}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {formatQty(e.bf, l.unit)}
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
          ['Quantity', formatUnitTotals(lines.map((l) => ({ unit: l.unit, qty: l.bf }))), '#fff'],
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

      {/*
        A losing line can hide behind a healthy total. On the case that prompted
        this — one line at $2.50/BF against $3.00 cost, losing $826 — the strip
        above still read $1,744 and 21.8% in green, and the strip is what the eye
        goes to on the last screen before the order is created. The Pricing step
        already flags these; Review is where it actually costs money to miss one.
        Warns only, and names the lines so the trader can go back to them.
      */}
      {(lowPricedLines.length > 0 || economics.some((e) => e.profit < 0)) && (
        <div
          style={{
            padding: '11px 14px',
            borderRadius: 9,
            border: '1px solid #FDE68A',
            background: '#FEF9C3',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <div style={{ flex: 1, fontSize: 12.5, color: '#713F12', lineHeight: 1.5 }}>
            <strong>
              {economics.filter((e) => e.profit < 0).length > 0
                ? `${economics.filter((e) => e.profit < 0).length} ${
                    economics.filter((e) => e.profit < 0).length === 1 ? 'line loses' : 'lines lose'
                  } money on this order`
                : `${lowPricedLines.length} line${lowPricedLines.length === 1 ? '' : 's'} priced under the trigger`}
            </strong>{' '}
            — the order total above can still look healthy while an individual line does not.{' '}
            {lines
              .filter((l, i) => economics[i].profit < 0 || isLowPriced(l))
              .map((l) => l.lotNo)
              .join(', ')}
            . Go <strong>Back</strong> to Pricing to change it, or create the order as it stands.
          </div>
        </div>
      )}

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
              // #8F5612, not #B36B16. This is the line that tells the trader WHY
              // Continue is dead, and at 3.99:1 on the footer it was the least
              // readable text on the step. Same amber family, 5.1:1.
              <span style={{ fontSize: 11.5, color: AMBER_TEXT, fontWeight: 600 }}>
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
