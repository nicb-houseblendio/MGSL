/**
 * Order economics for CWP ARCH.
 *
 * 🔴 EVERY RATE BELOW IS A PLACEHOLDER carried over from the offline prototype,
 * where they are marked "pending real values". They are NOT client-confirmed.
 * The screen surfaces that fact to the trader rather than hiding it — see the
 * provisional-pricing notice in the wizard's Pricing and Review steps. Do not
 * quote a customer from these numbers, and do not let them harden into fact
 * because they have been in the codebase a while.
 *
 * The margin model itself is the part worth keeping: the trader enters a price
 * per board foot and immediately sees profit against the LOT COST, which is what
 * was asked for — "dans le monde idéal, on a un genre de profit qui se calcule en
 * fonction du prix du lot, fait que ça leur donne une idée de leur margin".
 */

import type {
  ArchCartLine,
  ArchRemanIntent,
  ArchSplitIntent,
  ArchOrderTotals,
} from '@/types/archOrder';

/* ── Provisional rates ──────────────────────────────────────────────────────*/

/** Flat handling fee per lot that has to be physically split. */
export const SPLIT_FEE = 200;
/** Surfacing, $ per board foot. */
export const PLANING_RATE = 0.2;
/** Cutting to length, $ per board foot. */
export const CUT_RATE = 0.15;
/** Operations + insurance, as a fraction of the line's MATERIAL COST. */
export const OPS_INSURANCE_RATE = 0.065;

export const RATES_ARE_PROVISIONAL = true;

/* ── Per-line maths ─────────────────────────────────────────────────────────*/

/** Board feet actually going on the order: the split target when split, else the whole lot. */
export const orderedBF = (line: ArchCartLine, split: ArchSplitIntent | undefined): number => {
  if (split?.on) {
    const v = parseFloat(split.targetBF);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  return line.bf;
};

export interface ArchLineEconomics {
  bf: number;
  revenue: number;
  lotCost: number;
  splitCost: number;
  planingCost: number;
  cuttingCost: number;
  processingCost: number;
  opsInsuranceCost: number;
  profit: number;
  marginPct: number;
}

export const lineEconomics = (
  line: ArchCartLine,
  split: ArchSplitIntent | undefined,
  reman: ArchRemanIntent | undefined,
  pricePerBF: number
): ArchLineEconomics => {
  const bf = orderedBF(line, split);
  const revenue = bf * (pricePerBF || 0);
  const lotCost = bf * (line.costPerBF || 0);

  const splitCost = split?.on ? SPLIT_FEE : 0;
  const planingCost = reman?.planing ? bf * PLANING_RATE : 0;
  const cuttingCost = reman?.cutting ? bf * CUT_RATE : 0;
  const processingCost = splitCost + planingCost + cuttingCost;
  // Charged on MATERIAL COST, not revenue. The prototype is explicit about this
  // (`opIns = l.mbf * l.avgPriceMBF * OPINS_RATE` — quantity x lot cost), and the
  // basis is not cosmetic: costing it on revenue makes the charge rise with the
  // price the trader types, so raising the price made the margin look worse than
  // it is. Insurance and handling track the value of the WOOD, not the invoice.
  const opsInsuranceCost = lotCost * OPS_INSURANCE_RATE;

  const profit = revenue - lotCost - processingCost - opsInsuranceCost;

  return {
    bf,
    revenue,
    lotCost,
    splitCost,
    planingCost,
    cuttingCost,
    processingCost,
    opsInsuranceCost,
    profit,
    // Margin on revenue. Zero revenue means no margin rather than a division blow-up.
    marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
  };
};

export const sumEconomics = (rows: ArchLineEconomics[]): ArchOrderTotals => {
  const t = rows.reduce(
    (acc, r) => ({
      bf: acc.bf + r.bf,
      revenue: acc.revenue + r.revenue,
      lotCost: acc.lotCost + r.lotCost,
      processingCost: acc.processingCost + r.processingCost,
      opsInsuranceCost: acc.opsInsuranceCost + r.opsInsuranceCost,
      profit: acc.profit + r.profit,
    }),
    { bf: 0, revenue: 0, lotCost: 0, processingCost: 0, opsInsuranceCost: 0, profit: 0 }
  );
  return { ...t, marginPct: t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0 };
};

/* ── Formatting ─────────────────────────────────────────────────────────────*/

export const fmtMoney = (n: number, currency = 'USD', decimals = 2): string =>
  n.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export const fmtPct = (n: number): string => `${n.toFixed(1)}%`;

/** Below this the trade is not worth doing — colours the margin readout. */
export const MARGIN_WARN_PCT = 10;

export const marginColor = (pct: number): string =>
  pct < 0 ? '#B22222' : pct < MARGIN_WARN_PCT ? '#B36B16' : '#1E6B47';

/**
 * Dressed-thickness options for a nominal quarter thickness.
 *
 * ⚠️ PLACEHOLDER FORMULA, same provenance as the rates. Three notional passes —
 * light (~4% off), standard (~12.5%), heavy (~20%) — proportional to nominal
 * thickness. Real dressing tables have to come from the client.
 */
export const planingOptions = (thickness: string): string[] => {
  // NOT anchored. This is called with the item DESCRIPTION ("Sapele 6/4 KD") as
  // a fallback, not always a bare thickness, so `^` never matched and every item
  // silently fell back to nominal = 1 — offering 4/4 dressing options on 8/4 stock.
  //
  // ⚠️ The trailing guard is `(?!\d)`, NOT `\b`. An earlier edit put a literal
  // BACKSPACE byte (0x08) here instead of the two-character escape: the regex
  // then demanded a backspace after the "4" and could never match, so this stayed
  // broken while *looking* correct — terminals and diffs render 0x08 invisibly,
  // and it is a valid regex, so tsc and review both passed it. Caught only by
  // clicking the deployed UI. Do not "simplify" this back to \b.
  const m = String(thickness || '').match(/(\d+)\s*\/\s*4(?!\d)/);
  const nominal = m ? parseInt(m[1], 10) / 4 : 1;
  const toFraction = (v: number): string => {
    if (!(v > 0)) return '0';
    const denom = 16;
    const n = Math.round(v * denom);
    const whole = Math.floor(n / denom);
    const num = n % denom;
    if (num === 0) return String(whole);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const d = gcd(num, denom);
    const frac = `${num / d}/${denom / d}`;
    return whole > 0 ? `${whole}-${frac}` : frac;
  };
  const targets = [nominal * 0.96, nominal * 0.875, nominal * 0.8].map(toFraction);
  return [...Array.from(new Set(targets)), 'other'];
};
