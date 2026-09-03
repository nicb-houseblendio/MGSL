/**
 * Order economics for CWP ARCH.
 *
 * 🔴 THE SERVICE RATES BELOW ARE PLACEHOLDERS carried over from the offline
 * prototype, where they are marked "pending real values". They are NOT
 * client-confirmed. The screen surfaces that fact to the trader rather than
 * hiding it — see the provisional-pricing notice in the wizard's Pricing and
 * Review steps. Do not quote a customer from these numbers, and do not let them
 * harden into fact because they have been in the codebase a while.
 *
 * ⚠️ Operations & insurance is a REAL rate that this screen nonetheless gets
 * wrong twice, and the earlier version of this note claimed the opposite. It
 * said NetSuite "has been carrying the real rate all along on the SO header",
 * which was read as agreement. It is not:
 *
 *   THE RATE.  `custbody_mgsl_insurancerate` is sourced from the customer, and
 *              the customer's rate is sourced from its credit insurer
 *              (customrecord_mgsl_assureur -> customer -> transaction; the
 *              chain is readable in customfield.source). Measured in prod
 *              2026-09-03: 664 customers on Atradius at 0.003, 29 at 0.015, 18
 *              at 0.0015, 105 with no insurer and no rate. This screen prices
 *              every one of them at the configured default.
 *   THE BASIS.  Production charges it on REVENUE. MCGI_SUE_SalesPurchaseDiscount
 *              computes (subtotal * rate) / 100, and the GL agrees to the cent
 *              on five sampled prod documents (CM-CWP-63 4,515.84 -> 13.55;
 *              CM-CWP-61 2,284.80 -> 6.85; CM-CWP-62 1,927.46 -> 5.78;
 *              CM-CWP-60 1,612.80 -> 4.84; IND001051 443.92 -> 1.33). This file
 *              charges it on lot cost -- see the basis note at
 *              `opsInsuranceCost`, which is deliberate and now contradicted.
 *
 * Both differences run the same way: they understate the charge and flatter the
 * margin. Left as-is pending MGSL's decision on the basis, because changing it
 * changes every quoted margin on the screen. The prototype's own figure was
 * separately wrong by 21.7x, which is why a measured rate is used at all.
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

/**
 * Flat handling fee per lot that has to be physically split.
 *
 * 🔴 CONFIGURATION, DEFAULT OFF, and the two halves of that are separate facts.
 *
 * The AMOUNT is the client's own: $200/split, on Marc-Antoine's checklist in his
 * words. What has never been confirmed is whether we should APPLY it, and Nic's
 * design is explicit that it must not be hard-coded: "built as config, default
 * OFF, until confirmed". So the rate is known and the instruction to charge it
 * is not, which is exactly why this is a switch rather than a constant.
 *
 * So the amount lives on the trader-screen Suitelet as a script parameter and
 * arrives through MCGI_CONFIG. With nothing configured the fee is simply not
 * charged, which is the honest default: billing a customer a number nobody has
 * agreed is worse than billing nothing and being asked why.
 *
 * `splitFeeEnabled()` and `splitFee()` are functions rather than constants
 * because the config is not present when this module is first evaluated.
 */
export const splitFeeEnabled = (): boolean => {
  const cfg = (window as unknown as { MCGI_CONFIG?: { splitFeeEnabled?: boolean } }).MCGI_CONFIG;
  return cfg?.splitFeeEnabled === true;
};

export const splitFee = (): number => {
  if (!splitFeeEnabled()) return 0;
  const cfg = (window as unknown as { MCGI_CONFIG?: { splitFeeAmount?: number } }).MCGI_CONFIG;
  const n = Number(cfg?.splitFeeAmount);
  return isFinite(n) && n >= 0 ? n : 0;
};

/**
 * ⚠️ MISNAMED, and the name caused a real error. This is NOT a placeholder we
 * invented: $200/split is the CLIENT'S stated rate, in his own words on his own
 * checklist ("Presentment 200$/split et 0.20$/mbf pour chaque reman"). I twice
 * described it as a prototype figure MGSL had never confirmed, wrote that into
 * the UI, and it nearly went into a client meeting as the question "is there a
 * split fee?" -- a question he had already answered in writing.
 *
 * Kept under the old name only because renaming an exported constant is not
 * worth a churn commit. What it means: the rate he quoted, which we do NOT
 * charge yet. `splitFee()` is what bills, and it returns 0 until MGSL switch it
 * on, because applying a charge nobody has asked us to apply is the worse error.
 */
export const SPLIT_FEE_PLACEHOLDER = 200;
/* ── Reman rates — CONFIRMED BY THE CLIENT 2026-08-21, no longer placeholders ──
 *
 * Marc-Antoine, in writing: "0.20$/BF … C'est 0.20$ pour chacun des services. Ex
 * j'ai de la coupe + du planage sur une ligne de SO ce serait donc 0.40/bf."
 *
 * Two things settled at once:
 *   - the UNIT is the board foot, not the MBF. The question was worth asking: the
 *     two readings were 1000x apart, $80 against $0.08 on a 400 BF line.
 *   - **EACH service is $0.20.** Cutting was 0.15 here, carried over from the
 *     prototype and never confirmed, and it was simply WRONG — it under-reported
 *     the cost of every cut line by 25%. Both are 0.20 now, and a line carrying
 *     both services costs 0.40/BF, which is exactly his worked example.
 *
 * He also settled how the money flows, which changes nothing in the code and is
 * worth writing down because it confirms the model rather than altering it: the
 * TRADER includes the fee in the selling price, and MGSL post a journal entry at
 * invoicing that lands the cost in the profitability report. So revenue already
 * covers it and the cost is genuinely MGSL's — which is why deducting it from
 * profit here is right, and why there is no separate charge line to create.
 */
/** Surfacing, $ per board foot. Client-confirmed 2026-08-21. */
export const PLANING_RATE = 0.2;
/** Cutting to length, $ per board foot. Client-confirmed 2026-08-21 — was 0.15. */
export const CUT_RATE = 0.2;
/**
 * Operations + insurance, as a fraction of the line's MATERIAL COST.
 *
 * ✅ NOT a placeholder. This is the one rate the prototype guessed at that
 * NetSuite already answers: `custbody_mgsl_insurancerate` on the SO header.
 * Measured 2026-08-20 across all 4,216 sales orders in the account:
 *
 *   | value              | SOs           |
 *   | 0.003              | 3,979 (94.4%) |
 *   | null               | 48            |
 *   | range              | 0.0015–0.015  |
 *   | mean               | 0.0035        |
 *
 * So the real charge is 0.3% of material cost. The prototype carried 6.5%,
 * which is 21.7x too high and was deducted from every line's profit. On a
 * 15,061 BF purpleheart lot at $4.32/BF the charge falls from $4,229 to $195, so
 * $4,034 of the deduction was invented.
 *
 * ── Why a configured default rather than a read of the field ────────────────
 * The wizard prices a DRAFT. There is no SO record to read the rate off until
 * the order is created, so a default is not laziness here, it is the only thing
 * available at the moment the trader needs the number.
 *
 * ⚠️ "Overridable through MCGI_CONFIG" is what this used to say, and it is
 * false. No SuiteScript emits an `opsInsuranceRate` key: the live production
 * shell (file 54340, sha256 1127971f..., 2026-05-01) builds a configObj of eight
 * keys and the word "insurance" does not appear in it. The fallback below is
 * therefore the only value this screen has ever used, so treat it as a constant
 * that merely looks configurable.
 *
 * ⚠️ And the write path deliberately no longer stamps this value over the
 * SO. It used to, which overwrote the rate NetSuite sources from the customer;
 * `customerInsuranceRate` in archOrderCreate.js now fills the field only when
 * the customer carries no rate of its own. So the number below is a QUOTE, not
 * a prediction of what the order will record.
 */
export const OPS_INSURANCE_RATE_DEFAULT = 0.003;

export const opsInsuranceRate = (): number => {
  const cfg = (window as unknown as { MCGI_CONFIG?: { opsInsuranceRate?: number } }).MCGI_CONFIG;
  const n = Number(cfg?.opsInsuranceRate);
  return isFinite(n) && n >= 0 ? n : OPS_INSURANCE_RATE_DEFAULT;
};

/*
 * `RATES_ARE_PROVISIONAL = true` used to live here. Deleted 2026-08-21: nothing
 * imported it, and it had become false. ops+insurance is a real 0.003 (the house
 * Atradius rate, not a read of the SO -- see the header), and the reman rates are
 * client-confirmed; the only unconfirmed figure
 * left is the split fee, which `splitFeeEnabled()` already gates to zero. An
 * exported flag nobody reads cannot be trusted to be true, and tsc will never
 * say so -- unused EXPORTS are not errors, which is exactly how it survived
 * being wrong.
 */

/* ── Per-line maths ─────────────────────────────────────────────────────────*/

/** Board feet actually going on the order: the split target when split, else the whole lot. */
export const orderedBF = (line: ArchCartLine, split: ArchSplitIntent | undefined): number => {
  if (split?.on) {
    const v = parseFloat(split.targetBF);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  return line.preSplitQty;
};

export interface ArchLineEconomics {
  orderedQty: number;
  revenue: number;
  lotCost: number;
  /**
   * False when the lot has NO known cost, which is not the same as a cost of
   * zero. `lotCost`, `opsInsuranceCost`, `profit` and `marginPct` are all
   * meaningless on such a line and the UI must show a dash rather than a figure.
   *
   * 🔴 Without this the line reports its FULL REVENUE AS PROFIT, so the margin
   * looks perfect exactly when we do not know what the wood cost. On a pricing
   * screen that pushes a trader to accept a price they would otherwise refuse.
   *
   * Same predicate and same treatment as the Open SO tab, which hit this first
   * (`96cbadf`): a lot that has already been sold may no longer be on hand to
   * cost. All 13 cache rows carry a real cost today, so this is not reachable
   * yet, but it is the identical bug in the identical feature.
   */
  costKnown: boolean;
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
  /*
   * `|| 0` is kept ON PURPOSE, and `costKnown` is what makes it safe.
   *
   * Every consumer of `lotCost` and `profit` expects a number, so returning NaN
   * or null here would spread the unknown through sums, colour thresholds and the
   * negative-margin warning, and each of those would have to defend itself. The
   * arithmetic stays total; the HONESTY lives in the flag, and the UI refuses to
   * print a figure when it is false. Same split the Open SO tab uses.
   */
  const costKnown = line.costPerBF !== null && line.costPerBF !== undefined;
  const lotCost = bf * (line.costPerBF || 0);

  const splitCost = split?.on ? splitFee() : 0;
  /*
   * The reman rates are BOARD FOOT rates. The client confirmed the unit
   * explicitly, which is what makes this a real constraint rather than a
   * pedantic one: a cart can mix a Lumber line in BF with a Veneer line in
   * SQFT or a UNIT line, and 3 of the 13 rows in the live ARCH cache are not
   * BF. Multiplying a square-foot quantity by a per-board-foot rate produces a
   * number with no meaning, and it would flow straight into the margin the
   * trader prices against.
   *
   * So a non-BF line records its reman instructions and is NOT costed. That is
   * a gap, deliberately visible: the alternative is to invent a rate the client
   * never gave. The Remanufacturing step says so on the line itself rather than
   * showing a dash that reads as "no services asked for".
   *
   * The split fee is untouched -- it is a flat charge per split, not per unit.
   */
  const remanChargeable = line.unit === 'BF';
  const planingCost = reman?.planing && remanChargeable ? bf * PLANING_RATE : 0;
  const cuttingCost = reman?.cutting && remanChargeable ? bf * CUT_RATE : 0;
  const processingCost = splitCost + planingCost + cuttingCost;
  /* Charged on MATERIAL COST, not revenue. The prototype is explicit about this
   * (`opIns = l.mbf * l.avgPriceMBF * OPINS_RATE` -- quantity x lot cost), and the
   * rationale is real: costing it on revenue makes the charge rise with the price
   * the trader types, so raising the price makes the margin look worse.
   *
   * ⚠️ BUT PRODUCTION DOES THE OPPOSITE, and this comment used to read as
   * though the question were settled. MCGI_SUE_SalesPurchaseDiscount posts
   * (subtotal * rate) / 100 off the invoice, i.e. REVENUE, and the GL agrees to
   * the cent on five sampled prod documents (see the header for the figures).
   * Across the four ARCH item lines this endpoint has written (sbx 126449,
   * 126450, 126654), revenue runs 1.607x to 2.135x each line's OWN lot cost:
   * PUR44KD at 6.94225 against 4.32, and ZEB84KD at 25.80844, 26.840775 and
   * 26.15255 against 14.15, 14.15 and 12.25 CAD/BF. So the real charge is 61% to
   * 113% larger than this line computes, and the error is optimistic at every
   * data point. An earlier draft quoted the 61% floor as the measurement.
   *
   * Those four prices were typed in testing, not traded, so read the range as
   * the spread seen so far and not as a measurement of ARCH pricing.
   *
   * Deliberately NOT changed here. Which basis is right is MGSL's call, not
   * ours: the prototype's reasoning is sound and the GL's behaviour is a fact,
   * and they disagree. Until it is settled the screen states the divergence in
   * its own copy rather than quietly picking a side. Do not "fix" this line
   * without that answer. */
  const opsInsuranceCost = lotCost * opsInsuranceRate();

  const profit = revenue - lotCost - processingCost - opsInsuranceCost;

  return {
    orderedQty: bf,
    revenue,
    lotCost,
    costKnown,
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
      orderedQty: acc.orderedQty + r.orderedQty,
      revenue: acc.revenue + r.revenue,
      lotCost: acc.lotCost + r.lotCost,
      processingCost: acc.processingCost + r.processingCost,
      opsInsuranceCost: acc.opsInsuranceCost + r.opsInsuranceCost,
      profit: acc.profit + r.profit,
    }),
    { orderedQty: 0, revenue: 0, lotCost: 0, processingCost: 0, opsInsuranceCost: 0, profit: 0 }
  );
  /*
   * ONE uncosted line makes the whole total unknown, deliberately. A total that
   * silently omits one line's cost is worse than no total, because it is
   * optimistic and looks authoritative. The Open SO tab made the same call.
   *
   * An empty cart is `true`: there is nothing unknown about a total of zero.
   */
  const allCostsKnown = rows.every((r) => r.costKnown);
  return { ...t, allCostsKnown, marginPct: t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0 };
};

/* ── Formatting ─────────────────────────────────────────────────────────────*/

/**
 * Money, and it must never be able to take the screen down.
 *
 * 🔴 `Intl` THROWS on a bad currency code, and this is called inside render, so an
 * unhandled RangeError unmounts the whole React tree and leaves a blank page.
 * That is not hypothetical: passing "US Dollar" instead of "USD" did exactly
 * that on 2026-08-20, and neither tsc nor the build caught it because both types
 * are `string`. Only clicking it did.
 *
 * So a bad code degrades to a plain number with the code appended, which is
 * legible and obviously wrong, rather than destroying the page. Fixing the caller
 * is still the right response — this is a floor, not a licence.
 */
export const fmtMoney = (n: number, currency = 'USD', decimals = 2): string => {
  try {
    return n.toLocaleString(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return `${n.toFixed(decimals)} ${currency}`;
  }
};

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
