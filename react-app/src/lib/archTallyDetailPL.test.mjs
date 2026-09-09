import { TALLY_DETAIL_PL, DETAIL_PL_TOTALS } from './archTallyDetailPL.ts';
import { toLengthDistribution, siblingsOf, sameItem, toWidthDistribution, checkPayload } from './archTally.ts';
import { demoTallyForLot, TALLY_314307, TALLY_CHECHEN, demoWidthTallyForLot, demoTallyProps } from './archTallyFixtures.ts';
import { lengthDisplayFt } from './archTallyLength.ts';

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

// ---- the document's own totals row is the only authority here
{
  const b = TALLY_DETAIL_PL.bundles;
  ok('14 bundles', b.length === DETAIL_PL_TOTALS.bundles, b.length);

  const pieces = b.reduce((a, x) => a + x.totals.pieces, 0);
  ok('pieces sum to the document total 1901', pieces === DETAIL_PL_TOTALS.pieces, pieces);

  // Volume is summed in integer thousandths: adding the stated 3dp/4dp decimals as
  // floats drifts, and the document's own SUBTOTAL adds the ROUNDED cells, not the
  // exact products. Never recompute volume from the matrix - see the header of
  // scripts/gen-detail-pl.py for why the rounding has no reproducible contract.
  const milli = b.reduce((a, x) => a + Math.round(x.totals.volumeM3 * 10000), 0);
  ok('volume sums to the document total 31.9613 m3',
    milli === Math.round(DETAIL_PL_TOTALS.volumeM3 * 10000), milli / 10000);
}

// ---- every bundle's width breakdown must foot to its own stated piece count.
// This is the check that makes the payload trustworthy: it is the one thing a
// consumer can verify without the source document.
{
  let bad = [];
  for (const b of TALLY_DETAIL_PL.bundles) {
    const rows = b.matrix.rows;
    const summed = rows.reduce(
      (a, r) => a + Object.values(r.pieces).reduce((x, y) => x + y, 0), 0);
    if (summed !== b.totals.pieces) bad.push([b.bundleNo, summed, b.totals.pieces]);
  }
  ok('all 14 bundles: width counts foot to totals.pieces', bad.length === 0, bad);
}

// ---- the multi-width claim itself. If this ever fails, archTally.ts's header
// correction of 2026-09-04 is wrong and should be revisited.
{
  const counts = TALLY_DETAIL_PL.bundles.map((b) => b.matrix.widthsIn.length);
  ok('every bundle is multi-width', counts.every((n) => n >= 2), counts);
  ok('width cardinality is 11..22 as measured',
    Math.min(...counts) === 11 && Math.max(...counts) === 22, counts);
  ok('widths are declared metric', TALLY_DETAIL_PL.bundles.every((b) => b.matrix.widthUnit === 'mm'),
    TALLY_DETAIL_PL.bundles.map((b) => b.matrix.widthUnit));
  const keys = TALLY_DETAIL_PL.bundles.every((b) =>
    b.matrix.rows.every((r) => Object.keys(r.pieces).every((k) => b.matrix.widthsIn.includes(Number(k)))));
  ok('every pieces key appears in widthsIn', keys, null);
}

// ---- exactly one length per bundle. The corpus-wide claim that no bundle spans
// two lengths survives this document, which is why the LENGTH view stays correct.
{
  const rows = TALLY_DETAIL_PL.bundles.map((b) => b.matrix.rows.length);
  ok('one row (one length) per bundle', rows.every((n) => n === 1), rows);
}

// ---- the lot-key trap. t_lotno is document-level (WTR003) and shared by all 14;
// keying on it would make bundlesForLot return the whole document for any lot.
{
  const nos = new Set(TALLY_DETAIL_PL.bundles.map((b) => b.bundleNo));
  ok('bundleNo is per-bundle and unique', nos.size === 14, nos.size);
  ok('no bundle claims a NetSuite lot', TALLY_DETAIL_PL.bundles.every((b) => b.lot === null), null);
  ok('container is document-level', TALLY_DETAIL_PL.container === 'CAAU9944443', TALLY_DETAIL_PL.container);
  ok('grade survives extraction', TALLY_DETAIL_PL.bundles[0].grade === 'FIRST AND SECOND',
    TALLY_DETAIL_PL.bundles[0].grade);
}

// ---- the existing cross-bundle length view still works on this document, and
// agrees with the document totals. Both grains are correct, they are not rivals.
{
  const d = toLengthDistribution(TALLY_DETAIL_PL.bundles);
  ok('length view is not flagged mixed', d.mixedItems === false, d.mixedItems);
  ok('length view totals 1901 pieces', d.totals.pieces === 1901, d.totals.pieces);
  ok('length view finds the 8 distinct lengths', d.rows.length === 8, d.rows.length);
  ok('all 14 bundles are siblings of each other',
    siblingsOf(TALLY_DETAIL_PL.bundles, TALLY_DETAIL_PL.bundles[0]).length === 14, null);
  ok('sameItem holds across the document', sameItem(TALLY_DETAIL_PL.bundles[0], TALLY_DETAIL_PL.bundles[13]), null);
}

/* ---- ⚠️ THIS GUARD WAS INVERTED ON 2026-09-08, DELIBERATELY. It used to read:
 *
 *   // REGRESSION GUARD. This document must NOT reach the demo rotation: its
 *   // lengths are metric and would render as 7.874' on whichever lots the hash picked.
 *   ok('detail-pl is NOT served by demoTallyForLot', leaked.length === 0, leaked);
 *   ok('no demo lot renders a fractional length', metric.length === 0, metric);
 *
 * The guard was protecting the length column, and it worked. What it also did was keep
 * the only multi-width document out of reach of the screen, and with it the WIDTH
 * MATRIX - measured over the 67 ARCH lots holding stock, 0 of them could draw one.
 * That is the complaint Marc-Antoine put first on 2026-09-08: "La matrice pour
 * présenter le tally qui sera feedé par le custom record n'est pas présent."
 *
 * So the intent moves rather than disappears. The concern was never "detail-pl is
 * forbidden", it was "a trader must not read 7.874'". That is now enforced where it
 * belongs, at the display layer: archTallyLength.ts recovers the millimetre figure the
 * document printed, and the assertion below pins the OUTCOME the old one was proxying
 * for. Deleting it would have thrown away the requirement along with the mechanism. */
{
  const sampled = ['316027-1', '315970-7', '315604-13', '315411-16A', '1535', 'ZEB84KD-2'];

  ok('detail-pl IS now served by demoTallyForLot, which is what makes the matrix visible',
    sampled.every((lot) => demoTallyForLot(lot).sample.sourceFile === 'detail pl inv 2026_00031.xlsx'),
    sampled.map((l) => demoTallyForLot(l).sample.sourceFile));

  // THE ORIGINAL REQUIREMENT, still enforced: no trader reads a fractional foot.
  const unreadable = sampled.filter((lot) => {
    const d = demoTallyForLot(lot);
    return /\.\d+'/.test(lengthDisplayFt(d.bundle.lengthFt).text);
  });
  ok('no demo lot renders a fractional foot in its length cell', unreadable.length === 0, unreadable);
  ok('  ...because the metric ones render as whole millimetres instead',
    sampled.every((lot) => /^\d+mm$/.test(lengthDisplayFt(demoTallyForLot(lot).bundle.lengthFt).text)),
    sampled.map((l) => lengthDisplayFt(demoTallyForLot(l).bundle.lengthFt).text));

  // And the whole point of serving it: every lot gets a width breakdown that draws.
  ok('every sampled lot now draws a width grid',
    sampled.every((lot) => toWidthDistribution(demoTallyForLot(lot).bundle).degenerate === false), null);
}


/* ── toWidthDistribution, the second grain ──────────────────────────────────── */


// ---- against all 14 real bundles
{
  let bad = [];
  for (const b of TALLY_DETAIL_PL.bundles) {
    const w = toWidthDistribution(b);
    if (w.unit !== 'mm') bad.push([b.bundleNo, 'unit', w.unit]);
    if (w.totals.attributed !== b.totals.pieces) bad.push([b.bundleNo, 'pieces', w.totals.attributed]);
    if (!w.footsToTotal) bad.push([b.bundleNo, 'footsToTotal', false]);
    if (w.degenerate) bad.push([b.bundleNo, 'degenerate', true]);
    if (w.unattributed !== 0) bad.push([b.bundleNo, 'unattributed', w.unattributed]);
    if (w.rows.length !== b.matrix.widthsIn.length) bad.push([b.bundleNo, 'rowcount', w.rows.length]);
  }
  ok('width view is correct on all 14 real bundles', bad.length === 0, bad);

  const total = TALLY_DETAIL_PL.bundles
    .reduce((a, b) => a + toWidthDistribution(b).totals.attributed, 0);
  ok('width view across the document totals 1901', total === 1901, total);

  const first = toWidthDistribution(TALLY_DETAIL_PL.bundles[0]);
  ok('rows are ascending by width',
    first.rows.every((r, i, arr) => i === 0 || arr[i - 1].width <= r.width), first.rows.map((r) => r.width));
  ok('labels carry the unit', first.rows[0].label === '120mm', first.rows[0].label);
  ok('shares sum to 1', Math.abs(first.rows.reduce((a, r) => a + r.share, 0) - 1) < 1e-9, null);
}

// ---- degenerate: the single-width IPE document must be flagged, not drawn
{
  const w = toWidthDistribution(TALLY_314307.bundles[0]);
  ok('single-width bundle is degenerate', w.degenerate === true, w);
  ok('single-width unit defaults to inches', w.unit === 'in', w.unit);
  ok('single-width still foots', w.footsToTotal === true, w);
}

// ---- random width: CHECHEN attributes nothing, and must say so rather than guess
{
  const w = toWidthDistribution(TALLY_CHECHEN.bundles[0]);
  ok('RW bundle attributes zero pieces to a width', w.totals.attributed === 0, w.totals);
  ok('RW bundle reports its pieces as unattributed',
    w.unattributed === TALLY_CHECHEN.bundles[0].totals.pieces, w.unattributed);
  ok('RW bundle still foots to its total', w.footsToTotal === true, w);
  ok('RW bundle is degenerate', w.degenerate === true, w.degenerate);
  ok('RW unattributed row is labelled, not given a width',
    w.rows.length === 1 && w.rows[0].width === null && w.rows[0].label === 'unstated', w.rows);
}

// ---- trying to break it
{
  const B = (o) => ({ bundleNo: 'x', lot: null, species: null, thickness: null,
    matrix: null, totals: { pieces: null, boardFeet: null, volumeM3: null }, ...o });

  ok('null bundle does not throw', toWidthDistribution(null).rows.length === 0, null);
  ok('undefined bundle does not throw', toWidthDistribution(undefined).totals.attributed === 0, null);
  ok('matrix null yields an empty distribution', toWidthDistribution(B({})).rows.length === 0, null);

  // A pieces key absent from widthsIn is a parser fault. Count it, never invent a width.
  const rogue = toWidthDistribution(B({ totals: { pieces: 10, boardFeet: null, volumeM3: null },
    matrix: { widthsIn: [6], rows: [{ lengthFt: 8, pieces: { '6': 7, '9': 3 } }] } }));
  ok('a width not in widthsIn becomes unattributed, not a row',
    rogue.totals.attributed === 7 && rogue.unattributed === 3 && rogue.rows.length === 2, rogue);
  ok('...and it still foots to the stated total', rogue.footsToTotal === true, rogue);

  // Widths must sum ACROSS length rows, so a multi-length bundle yields one view.
  const multi = toWidthDistribution(B({ totals: { pieces: 100, boardFeet: null, volumeM3: null },
    matrix: { widthsIn: [6, 9], rows: [
      { lengthFt: 8, pieces: { '6': 30, '9': 20 } },
      { lengthFt: 12, pieces: { '6': 25, '9': 25 } }] } }));
  ok('widths sum across length rows', multi.rows.length === 2
    && multi.rows[0].pieces === 55 && multi.rows[1].pieces === 45, multi.rows);
  ok('multi-length bundle is not degenerate', multi.degenerate === false, multi.degenerate);

  // A short sum must be reported, never shown as a total.
  const short = toWidthDistribution(B({ totals: { pieces: 100, boardFeet: null, volumeM3: null },
    matrix: { widthsIn: [6], rows: [{ lengthFt: 8, pieces: { '6': 60 } }] } }));
  ok('a partial sum sets footsToTotal false', short.footsToTotal === false, short);

  // No stated total means we cannot claim it foots.
  const nototal = toWidthDistribution(B({
    matrix: { widthsIn: [6, 9], rows: [{ lengthFt: 8, pieces: { '6': 1, '9': 1 } }] } }));
  ok('unknown stated total does not claim to foot', nototal.footsToTotal === false, nototal);

  // A NEGATIVE count is nonsense the parser should never emit. Pinning the CURRENT
  // behaviour rather than asserting a guarantee we do not have: the value is summed
  // as-is and the row stays visible for inspection.
  //
  // ⚠️ AND footsToTotal DOES NOT SAVE YOU HERE. Below, 12 + (-2) = 10, which equals
  // the stated total, so the bundle foots while carrying impossible data. If a real
  // parser ever emits a negative, this reducer will not be what catches it - the
  // check belongs upstream, at the write, where record-format.md already puts it.
  const neg = toWidthDistribution(B({ totals: { pieces: 10, boardFeet: null, volumeM3: null },
    matrix: { widthsIn: [6, 9], rows: [{ lengthFt: 8, pieces: { '6': 12, '9': -2 } }] } }));
  ok('a negative count is surfaced, not swallowed', neg.totals.attributed === 10, neg.totals);
  ok('...and the row is still visible for inspection', neg.rows.length === 2, neg.rows);
  ok('a negative can still foot, so footsToTotal is NOT a validity check',
    neg.footsToTotal === true, neg.footsToTotal);

  // Zero counts must not become rows.
  const zeros = toWidthDistribution(B({ totals: { pieces: 5, boardFeet: null, volumeM3: null },
    matrix: { widthsIn: [6, 9, 12], rows: [{ lengthFt: 8, pieces: { '6': 5, '9': 0, '12': 0 } }] } }));
  ok('zero-count widths are omitted', zeros.rows.length === 1 && zeros.totals.widths === 1, zeros.rows);
}


/* ── widthLabel / widthNote must not lie about a multi-width bundle ─────────── */
{
  const { widthLabel, widthNote } = await import('./archTally.ts');
  const b = TALLY_DETAIL_PL.bundles[0];
  ok('multi-width label states the widths, not an em dash',
    widthLabel(b) === '19 widths, 120-340mm', widthLabel(b));
  // REGRESSION 2026-09-05: this returned "This document does not give a width for
  // these bundles" for a bundle carrying 19 printed widths.
  ok('multi-width bundle gets NO false "no width" caveat', widthNote(b) === '', widthNote(b));
  // The single-width and random-width paths must be untouched.
  ok('single-width scalar still wins', widthLabel(TALLY_314307.bundles[0]) === '5.5"',
    widthLabel(TALLY_314307.bundles[0]));
  ok('random width still says RW', widthLabel(TALLY_CHECHEN.bundles[0]) === 'RW',
    widthLabel(TALLY_CHECHEN.bundles[0]));
  ok('random width still gets its caveat', /random width/i.test(widthNote(TALLY_CHECHEN.bundles[0])),
    widthNote(TALLY_CHECHEN.bundles[0]));
}

// ---- demoWidthTallyForLot: the OPT-IN feed for the width table. Added 2026-09-05.
// The width table renders nothing on a degenerate bundle, and both documents in the
// demo rotation are degenerate, so without this accessor the table is unreachable.
{
  const sampled = ['316027-1', '315970-7', '315604-13', '315411-16A', '1535', 'ZEB84KD-2'];
  const got = sampled.map((l) => demoWidthTallyForLot(l));
  ok('every sampled lot gets a bundle', got.every((d) => d && d.bundle), got.map((d) => !!d));
  ok('every one of them is MULTI-width, so the table always draws',
    got.every((d) => toWidthDistribution(d.bundle).degenerate === false), null);
  ok('every one carries sample provenance naming the source document',
    got.every((d) => d.sample && d.sample.sourceFile === 'detail pl inv 2026_00031.xlsx'), got.map((d) => d.sample));
  ok('the container is carried, so the banner can name the shipment',
    got.every((d) => d.sample.container === 'CAAU9944443'), null);
  ok('deterministic: the same lot gives the same bundle twice',
    demoWidthTallyForLot('316027-1').bundle === demoWidthTallyForLot('316027-1').bundle, null);
  ok('the clicked bundle is always inside its own siblings',
    got.every((d) => d.siblings.indexOf(d.bundle) >= 0), null);
  ok('an empty lot number gets nothing', demoWidthTallyForLot('') === null, null);

  /* ⚠️ ALSO INVERTED 2026-09-08, and for the same reason as the guard further up. This
   * pair used to read:
   *
   *   // 🔴 THE POINT OF THE SEPARATE ACCESSOR. Adding detail-pl to DEMO_DOCS would have
   *   // been one line; it would also have put 7.874' lengths on a third of ARCH lots.
   *   ok('the default rotation is UNCHANGED by the new accessor', …)
   *   ok('  ...and still renders whole-foot lengths', …)
   *
   * "A third of ARCH lots" was the argument against a three-document rotation, and it
   * was right - which is why the pool is not a rotation. DEMO_PICKS selects BUNDLES
   * that can draw a width breakdown, so it is all of them or none, never a third. The
   * accessor kept below is now the same document by name, and what has to be pinned is
   * that the by-name route and the default route agree. */
  ok('the default route and the named accessor now serve the same document',
    sampled.every((l) => demoTallyForLot(l).sample.sourceFile === demoWidthTallyForLot(l).sample.sourceFile), null);
  ok('  ...and every length it renders is a whole millimetre, not a fractional foot',
    sampled.every((l) => /^\d+mm$/.test(lengthDisplayFt(demoTallyForLot(l).bundle.lengthFt).text)), null);

  /* THE IMPERIAL AND RANDOM-WIDTH DOCUMENTS MUST STAY REACHABLE. They are off the
   * default screen now, which is a real cost, so the escape hatch is pinned rather
   * than left to a comment. */
  const g2 = globalThis;
  const had2 = Object.prototype.hasOwnProperty.call(g2, 'window');
  if (!had2) g2.window = {};
  g2.window.MCGI_CONFIG = { tallyDemoDoc: '314307' };
  ok("tallyDemoDoc = '314307' brings back the imperial document",
    sampled.every((l) => demoTallyProps(l).sample.sourceFile === TALLY_314307.provenance.sourceFile), null);
  ok('  ...with whole-foot lengths', sampled.every((l) => Number.isInteger(demoTallyProps(l).bundle.lengthFt)), null);
  g2.window.MCGI_CONFIG = { tallyDemoDoc: 'chechen' };
  ok("tallyDemoDoc = 'chechen' brings back the random-width document, which is what shows the RW caveat",
    sampled.every((l) => demoTallyProps(l).bundle.widthPolicy === 'randomWidth'), null);
  g2.window.MCGI_CONFIG = { tallyDemoDoc: 'not-a-document' };
  ok('an unknown key falls back to the default pool rather than emptying the dialog',
    sampled.every((l) => demoTallyProps(l).bundle === demoTallyForLot(l).bundle), null);
  if (!had2) delete g2.window; else delete g2.window.MCGI_CONFIG;
}

// ---- demoTallyProps: ONE selection, so the two call sites cannot diverge again.
// Added 2026-09-05. ArchReservedSection passed none of these until then, so a reserved
// lot had two tally buttons on one screen opening two different dialogs.
{
  const sampled = ['316027-1', '315970-7', '315604-13', '315411-16A', '1535', 'ZEB84KD-2'];
  const props = sampled.map((l) => demoTallyProps(l));
  ok('every lot gets all three props, not a subset',
    props.every((p) => p.bundle && Array.isArray(p.siblings) && p.sample), props.map((p) => Object.keys(p)));
  ok('two calls for the same lot agree, so both tables show the same dialog',
    sampled.every((l) => demoTallyProps(l).bundle === demoTallyProps(l).bundle), null);
  ok('it matches demoTallyForLot while the flag is unset',
    sampled.every((l) => demoTallyProps(l).bundle === demoTallyForLot(l).bundle), null);
  ok('the clicked bundle is findable by identity inside its siblings, which is how the dialog marks it',
    props.every((p) => p.siblings.indexOf(p.bundle) >= 0), null);
  ok('an empty lot number yields undefined props rather than throwing',
    demoTallyProps('').bundle === undefined, null);

  // the opt-in flag, exercised through the same helper both components call
  const g = globalThis;
  const had = Object.prototype.hasOwnProperty.call(g, 'window');
  if (!had) g.window = {};
  g.window.MCGI_CONFIG = { tallyDemoDoc: 'detail-pl' };
  ok('with the flag set, the helper serves the multi-width document',
    sampled.every((l) => demoTallyProps(l).sample.sourceFile === 'detail pl inv 2026_00031.xlsx'), null);
  ok('  ...and every bundle it serves is multi-width',
    sampled.every((l) => toWidthDistribution(demoTallyProps(l).bundle).degenerate === false), null);
  g.window.MCGI_CONFIG = {};
  ok('clearing the flag restores the default rotation',
    sampled.every((l) => demoTallyProps(l).bundle === demoTallyForLot(l).bundle), null);
  if (!had) delete g.window; else delete g.window.MCGI_CONFIG;
}

// ---- demoTallyProps with REAL data. Added 2026-09-07 when the serve side landed.
// The sample banner is the only thing telling a trader the numbers are not this lot's
// own document, so its presence/absence is the load-bearing assertion here.
{
  const realBundles = [
    { bundleNo: 'A', lot: '316027-1', species: 'SAPELI KD', thickness: { raw: '25mm', inches: 0.98 },
      width: null, widthPolicy: 'printed', lengthFt: 8, grade: 'FAS',
      matrix: { widthsIn: [6, 9], widthUnit: 'in', rows: [{ lengthFt: 8, pieces: { '6': 30, '9': 20 } }] },
      totals: { pieces: 50, boardFeet: 240, volumeM3: null }, provenance: { page: null, confidence: null } },
  ];
  const real = demoTallyProps('316027-1', { status: 'PARSED', sourceFile: 'PL.pdf', docUrl: null, bundles: realBundles });

  ok('real data is preferred over the fixture', real.bundle === realBundles[0], real.bundle && real.bundle.bundleNo);
  ok('  ...and carries NO sample banner, which would be a lie beside real numbers',
    real.sample === undefined, real.sample);
  ok('  ...with the clicked bundle inside its own siblings', real.siblings.indexOf(real.bundle) >= 0, null);
  ok('  ...and the width table would draw from it',
    toWidthDistribution(real.bundle).degenerate === false, toWidthDistribution(real.bundle));

  // null tally is the COMMON case: most lots have no matching bundle, by design
  const none = demoTallyProps('316027-1', null);
  ok('a lot with no tally falls back to the fixture', none.bundle === demoTallyForLot('316027-1').bundle, null);
  ok('  ...and the fixture DOES carry the sample banner', !!none.sample, none.sample);
  ok('an empty bundles array is treated as no tally',
    demoTallyProps('316027-1', { status: 'PARSED', bundles: [] }).sample !== undefined, null);
  ok('an undefined tally behaves exactly as before', demoTallyProps('316027-1').sample !== undefined, null);
}

// ---- FIX 2 + 3, from the 2026-09-08 adversarial review.
// The dialog now checks the WHOLE sibling set before drawing a length total, and real
// data carries its own provenance line now that the sample banner is correctly absent.
{
  const good = { bundleNo: 'G', lot: 'L1', species: 'ZEBRAWOOD', thickness: { raw: '8/4', inches: 2 },
    width: null, widthPolicy: 'printed', lengthFt: 8, grade: 'FAS',
    matrix: { widthsIn: [6, 9], widthUnit: 'in', rows: [{ lengthFt: 8, pieces: { '6': 20, '9': 20 } }] },
    totals: { pieces: 40, boardFeet: 320, volumeM3: null }, provenance: { page: null, confidence: null } };
  // states 30, columns sum to 25 - the real shape of seeded lot 316027-2
  const bad = { ...good, bundleNo: 'B', lot: 'L2', lengthFt: 12,
    matrix: { widthsIn: [6, 9], widthUnit: 'in', rows: [{ lengthFt: 12, pieces: { '6': 15, '9': 10 } }] },
    totals: { pieces: 30, boardFeet: 360, volumeM3: null } };

  const P = (bundles) => ({ schema: 'mgsl.tally.v1', po: null, container: null, bundles });

  ok('a clean set may be totalled', checkPayload(P([good])).ok, null);
  ok('a non-footing bundle refuses the total', checkPayload(P([bad])).ok === false, null);
  ok('ONE bad member poisons the whole set, because the total sums them all',
    checkPayload(P([good, bad])).ok === false, checkPayload(P([good, bad])).issues);
  ok('  ...and the message names the offending bundle so the refusal is actionable',
    checkPayload(P([good, bad])).issues[0].bundleNo === 'B', checkPayload(P([good, bad])).issues[0]);
  ok('  ...and states both figures', (() => {
    const d = checkPayload(P([good, bad])).issues[0].detail;
    return d.indexOf('30') >= 0 && d.indexOf('25') >= 0;
  })(), checkPayload(P([good, bad])).issues[0].detail);
  // the length reducer itself still computes a total; the REFUSAL is the view's job
  ok('the reducer still reports its arithmetic, the view decides whether to print it',
    toLengthDistribution([good, bad]).totals.pieces === 70, toLengthDistribution([good, bad]).totals);

  // fix 3: provenance
  const real = demoTallyProps('316027-2', { status: 'PARSED', sourceFile: 'PL-real.pdf', docUrl: null, bundles: [bad] });
  ok('real data carries a source line', !!real.source, real.source);
  ok('  ...naming the document', real.source.sourceFile === 'PL-real.pdf', real.source);
  ok('  ...and the capture status', real.source.status === 'PARSED', real.source);
  ok('  ...while the sample banner stays absent', real.sample === undefined, null);
  ok('a fixture carries a sample and NO source line', (() => {
    const f = demoTallyProps('316027-2', null);
    return !!f.sample && !f.source;
  })(), null);
  ok('so exactly one provenance line renders, never two and never zero', (() => {
    for (const t of [null, { status: 'PARSED', sourceFile: 'x.pdf', bundles: [bad] }]) {
      const p = demoTallyProps('316027-2', t);
      if (!!p.sample === !!p.source) return false;
    }
    return true;
  })(), null);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
