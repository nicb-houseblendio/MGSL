/**
 * Converting a Canadian cost into the currency the order is billed in.
 *
 * Feedback 6 item 10b, Marc-Antoine 2026-09-14: "Calcul du profit : Est-ce qu'il
 * prend en compte la devise du SO vs la devise du lot? ... on a du cad et USD
 * mixed ... idéalement on le converti en USD au taux du SO date."
 *
 * The rate below is the real one: NetSuite answered 0.719115 for CAD to USD on
 * 2026-09-15, the reciprocal of the 1.3906 it stamps on a USD sales order that
 * day. Verified against SO-CWP-001375, a real USD order carrying exchangerate
 * 1.3906.
 */
// The pricing module reads MCGI_CONFIG off `window` for the split fee and the
// ops rate, so node needs one before the import is evaluated. Empty is the
// shipped default: no split fee, and the fallback ops rate.
globalThis.window = { MCGI_CONFIG: {} };

const { lineEconomics, sumEconomics, PLANING_RATE, CUT_RATE, isLowPricedAt, LOW_PRICE_TRIGGER } =
  await import('./archOrderPricing.ts');

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

const CAD_TO_USD = 0.719115;

/** 611 BF of African Mahogany at CA$3.72, the row used in the live UAT. */
const line = {
  key: 'k1', lotNo: '315508-10', internalId: '1', locationId: '1',
  description: 'African Mahogany 4/4 KD', unit: 'BF',
  preSplitQty: 611, costPerBF: 3.72,
};

/* Unconverted is still the default, because a Canadian order needs no rate and
 * because a missing rate must not silently become one. */
{
  const e = lineEconomics(line, undefined, undefined, 6.5);
  ok('default is no conversion', e.costFx === 1);
  ok('lot cost stays Canadian', near(e.lotCost, 611 * 3.72));
  ok('revenue is never touched by the rate', near(e.revenue, 611 * 6.5));
}

/* The case he described: USD revenue, CAD cost. */
{
  const raw = lineEconomics(line, undefined, undefined, 6.5);
  const conv = lineEconomics(line, undefined, undefined, 6.5, CAD_TO_USD);
  ok('the rate is reported back', conv.costFx === CAD_TO_USD);
  ok('lot cost is converted', near(conv.lotCost, 611 * 3.72 * CAD_TO_USD));
  ok('revenue is NOT converted, it is already the order currency', near(conv.revenue, raw.revenue));
  ok('🔴 profit rises, because the costs were overstated in USD terms',
    conv.profit > raw.profit, { raw: raw.profit, conv: conv.profit });
  ok('  ...and by the amount the conversion removes',
    near(conv.profit - raw.profit, (raw.lotCost + raw.opsInsuranceCost) * (1 - CAD_TO_USD)),
    { diff: conv.profit - raw.profit });
  // marginPct is a PERCENT, not a fraction. Asserted explicitly because the
  // first version of this test compared it to the fraction and passed nothing.
  ok('margin is computed on the converted profit, as a percent',
    near(conv.marginPct, (conv.profit / conv.revenue) * 100, 0.01), conv.marginPct);
  ok('  ...and the unconverted margin really is the lower one',
    lineEconomics(line, undefined, undefined, 6.5).marginPct < conv.marginPct);
}

/* Every cost component moves, not just the lot. */
{
  const conv = lineEconomics(line, undefined, { planing: true, cutting: true, planingSpec: '7/8', planingOther: '', cutLength: "8'" }, 6.5, CAD_TO_USD);
  ok('planing is converted', near(conv.planingCost, 611 * PLANING_RATE * CAD_TO_USD));
  ok('cutting is converted', near(conv.cuttingCost, 611 * CUT_RATE * CAD_TO_USD));
  ok('processing is the sum of the converted parts',
    near(conv.processingCost, conv.planingCost + conv.cuttingCost + conv.splitCost));
  // 🔴 The first version of this assertion was a tautology: it divided by the very
  // figure it was checking, so it would have passed on any number at all. What
  // matters is that ops and insurance is converted ONCE, not twice, which a
  // tautology cannot see. Compared against the unconverted line instead.
  {
    const raw = lineEconomics(line, undefined, { planing: true, cutting: true, planingSpec: '7/8', planingOther: '', cutLength: "8'" }, 6.5);
    ok('ops and insurance is converted exactly once',
      near(conv.opsInsuranceCost, raw.opsInsuranceCost * CAD_TO_USD, 0.0001),
      { conv: conv.opsInsuranceCost, expected: raw.opsInsuranceCost * CAD_TO_USD });
    ok('  ...and so is every other cost component',
      near(conv.lotCost, raw.lotCost * CAD_TO_USD, 0.0001) &&
        near(conv.planingCost, raw.planingCost * CAD_TO_USD, 0.0001) &&
        near(conv.cuttingCost, raw.cuttingCost * CAD_TO_USD, 0.0001));
    ok('  ...which is NOT true of revenue', near(conv.revenue, raw.revenue));
  }
  ok('profit deducts every converted cost',
    near(conv.profit, conv.revenue - conv.lotCost - conv.processingCost - conv.opsInsuranceCost));
}

/* A rate that is not a rate must not corrupt the arithmetic. */
{
  const bad = [0, -1, NaN, Infinity, undefined, null];
  const raw = lineEconomics(line, undefined, undefined, 6.5);
  bad.forEach((v) => {
    const e = lineEconomics(line, undefined, undefined, 6.5, v);
    ok('a rate of ' + String(v) + ' falls back to no conversion',
      e.costFx === 1 && near(e.lotCost, raw.lotCost), e.costFx);
  });
}

/* Totals carry the conversion too, or the summary and the lines disagree. */
{
  const conv = [lineEconomics(line, undefined, undefined, 6.5, CAD_TO_USD)];
  const t = sumEconomics(conv);
  ok('totals match the converted line', near(t.lotCost, conv[0].lotCost) && near(t.profit, conv[0].profit));
}

/* The reciprocal a trader recognises. NetSuite shows 1.3906 CAD per USD on the
 * order; the multiplier this screen uses is its inverse. */
ok('the multiplier and the quoted rate are reciprocals', near(1 / CAD_TO_USD, 1.3906, 0.0005));


/* Item 10c: the rates can come from the record, per service, with the constant as
 * the fallback for that service alone. */
{
  const reman = { planing: true, cutting: true, planingSpec: '7/8', planingOther: '', cutLength: "8'" };
  const base = lineEconomics(line, undefined, reman, 6.5);
  ok('a record rate replaces the constant',
    near(lineEconomics(line, undefined, reman, 6.5, 1, { planing: 0.25, cut: 0.25 }).planingCost, 611 * 0.25));
  ok('one missing rate falls back for that service ONLY',
    near(lineEconomics(line, undefined, reman, 6.5, 1, { planing: 0.25, cut: null }).cuttingCost, base.cuttingCost));
  ok('a nonsense rate is refused rather than applied',
    near(lineEconomics(line, undefined, reman, 6.5, 1, { planing: -1, cut: NaN }).planingCost, base.planingCost));
  ok('a zero rate IS honoured, because free is a price',
    lineEconomics(line, undefined, reman, 6.5, 1, { planing: 0, cut: 0 }).planingCost === 0);
  ok('the conversion and the record rate compose',
    near(lineEconomics(line, undefined, reman, 6.5, CAD_TO_USD, { planing: 0.25, cut: 0.25 }).planingCost,
      611 * 0.25 * CAD_TO_USD));
}


/* The low-price floor, which had the same currency bug the margin had and kept it
 * three weeks longer. Cost CA$3.72, so the true US floor is 3.72 * 0.719115 * 1.1
 * = US$2.943, not the US$4.092 the unconverted rule used. */
{
  const COST = 3.72;
  const floorUSD = COST * CAD_TO_USD * LOW_PRICE_TRIGGER;
  ok('the US floor is about 2.94, not 4.09', near(floorUSD, 2.9428, 0.001), floorUSD);
  ok('🔴 US$4.00 is NOT underpriced, and used to be flagged',
    isLowPricedAt(4.00, COST, CAD_TO_USD) === false);
  ok('US$2.80 IS underpriced', isLowPricedAt(2.80, COST, CAD_TO_USD) === true);
  ok('a hair under the floor warns', isLowPricedAt(floorUSD - 0.001, COST, CAD_TO_USD) === true);
  ok('exactly at the floor does not', isLowPricedAt(floorUSD, COST, CAD_TO_USD) === false);
  ok('a Canadian order keeps the old floor', isLowPricedAt(4.00, COST) === true);
  ok('  ...and 4.10 clears it', isLowPricedAt(4.10, COST) === false);
  ok('no price entered is not a low price', isLowPricedAt(0, COST, CAD_TO_USD) === false);
  ok('an unknown cost is not a low price',
    isLowPricedAt(1, null, CAD_TO_USD) === false && isLowPricedAt(1, undefined) === false);
  ok('a zero cost is not a low price either', isLowPricedAt(0.01, 0, CAD_TO_USD) === false);
  ok('a broken rate falls back to no conversion', isLowPricedAt(4.00, COST, 0) === true);
}

console.log(fail ? ('# FAIL ' + fail) : '# archOrderFx ok');
process.exit(fail ? 1 : 0);
