import { TALLY_DETAIL_PL, DETAIL_PL_TOTALS } from './archTallyDetailPL.ts';
import { toLengthDistribution, siblingsOf, sameItem, toWidthDistribution } from './archTally.ts';
import { demoTallyForLot, TALLY_314307, TALLY_CHECHEN } from './archTallyFixtures.ts';

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

// ---- REGRESSION GUARD. This document must NOT reach the demo rotation: its
// lengths are metric and would render as 7.874' on whichever lots the hash picked.
{
  const sampled = ['316027-1', '315970-7', '315604-13', '315411-16A', '1535', 'ZEB84KD-2'];
  const leaked = sampled.filter((lot) => {
    const d = demoTallyForLot(lot);
    return d && d.sample && d.sample.sourceFile === 'detail pl inv 2026_00031.xlsx';
  });
  ok('detail-pl is NOT served by demoTallyForLot', leaked.length === 0, leaked);
  const metric = sampled.filter((lot) => {
    const d = demoTallyForLot(lot);
    return d && d.bundle && d.bundle.lengthFt != null && !Number.isInteger(d.bundle.lengthFt);
  });
  ok('no demo lot renders a fractional length', metric.length === 0, metric);
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

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
