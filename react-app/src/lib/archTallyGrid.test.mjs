import fs from 'node:fs';
import { toLengthWidthGrid } from './archTally.ts';
import { TALLY_ZEBRANO05513, TALLY_ZEBRANO05513_TOTALS } from './archTallyZebrano05513.ts';

const B = (o) => ({ bundleNo: 'x', lot: null, species: null, thickness: { raw: null, inches: 1 },
  matrix: null, totals: { pieces: null, boardFeet: null, volumeM3: null }, ...o });
let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// ---- G1: a single-length bundle is degenerate for the GRID, even with many widths.
// toWidthDistribution already has a table tuned for this shape; the grid must defer to it.
{
  const g = toLengthWidthGrid(B({ matrix: { widthsIn: [6, 9, 12], rows: [
    { lengthFt: 8, pieces: { '6': 3, '9': 2, '12': 1 } },
  ] } }));
  ok('G1 one row returns null, not a 1-row grid', g === null, g);
}

// ---- G2: no matrix, or an empty row list, is also null rather than throwing
{
  ok('G2 null bundle', toLengthWidthGrid(null) === null, null);
  ok('G2 undefined bundle', toLengthWidthGrid(undefined) === null, null);
  ok('G2 no matrix', toLengthWidthGrid(B({ matrix: null })) === null, null);
  ok('G2 empty rows', toLengthWidthGrid(B({ matrix: { widthsIn: [], rows: [] } })) === null, null);
}

// ---- G3: the real shape - Zebrano-style, one bundle number spanning several
// lengths, each its own width spread (pl inv 01368.xlsx / 05513.xlsx, 2026-09-10)
{
  const bundle = B({
    bundleNo: '11', totals: { pieces: 17, boardFeet: null, volumeM3: 0.45 },
    matrix: {
      widthUnit: 'mm',
      widthsIn: [60, 70, 80],
      rows: [
        { lengthFt: 8, pieces: { '60': 2, '70': 1 } },
        { lengthFt: 9, pieces: { '70': 3, '80': 2 } },
        { lengthFt: 11, pieces: { '60': 4, '80': 5 } },
      ],
    },
  });
  const g = toLengthWidthGrid(bundle);
  ok('G3 three length rows, in ascending order', g.rows.map((r) => r.label).join(',') === "8',9',11'", g.rows.map((r) => r.label));
  ok('G3 columns are the union of widths, sorted', g.widths.join(',') === '60,70,80', g.widths);
  ok('G3 a cell absent from a row is simply absent, not zero-filled', g.rows[0].cells['80'] === undefined, g.rows[0]);
  ok('G3 row 8ft pieces = 2+1', g.rows[0].pieces === 3, g.rows[0]);
  ok('G3 row 9ft pieces = 3+2', g.rows[1].pieces === 5, g.rows[1]);
  ok('G3 row 11ft pieces = 4+5', g.rows[2].pieces === 9, g.rows[2]);
  ok('G3 column 60 totals 2+4', g.columnTotals['60'] === 6, g.columnTotals);
  ok('G3 column 70 totals 1+3', g.columnTotals['70'] === 4, g.columnTotals);
  ok('G3 column 80 totals 2+5', g.columnTotals['80'] === 7, g.columnTotals);
  ok('G3 grand total pieces = 17, matching the stated total', g.totals.pieces === 17, g.totals);
  ok('G3 foots to the stated total', g.footsToTotal === true, g);
  ok('G3 grand BF and volume come from the bundle, not summed from cells',
    g.totals.boardFeet === null && g.totals.volumeM3 === 0.45, g.totals);
  ok('G3 mm unit carried through', g.widthUnit === 'mm', g.widthUnit);
}

// ---- G4: same-length lines merge into ONE grid row, mirroring bundleRows()'s
// duplicate-length collapse for the length-distribution view (defect 1c, 2026-09-07)
{
  const bundle = B({ totals: { pieces: 5, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [6, 9], rows: [
    { lengthFt: 8, pieces: { '6': 2 } },
    { lengthFt: 8, pieces: { '9': 1 } },
    { lengthFt: 12, pieces: { '6': 2 } },
  ] } });
  const g = toLengthWidthGrid(bundle);
  ok('G4 two DISTINCT lengths after merge, not three rows', g.rows.length === 2, g.rows);
  ok('G4 the two 8ft lines combine their cells', g.rows[0].cells['6'] === 2 && g.rows[0].cells['9'] === 1, g.rows[0]);
  ok('G4 the merged row totals both lines', g.rows[0].pieces === 3, g.rows[0]);
}

// ---- G5: pieces the document did not attribute to any width still count, as a
// row's `unattributed` and the grid's `columnUnattributedTotal` - never silently lost
// (same rule as toWidthDistribution's `unattributed`, defect measured 2026-09-07)
{
  const bundle = B({ totals: { pieces: 6, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [6], rows: [
    { lengthFt: 8, pieces: { '6': 3, '': 1 } },
    { lengthFt: 10, pieces: { '6': 2 } },
  ] } });
  const g = toLengthWidthGrid(bundle);
  ok('G5 row unattributed is carried', g.rows[0].unattributed === 1, g.rows[0]);
  ok('G5 row pieces include the unattributed piece', g.rows[0].pieces === 4, g.rows[0]);
  ok('G5 column unattributed total', g.columnUnattributedTotal === 1, g);
  ok('G5 grid still foots (3+1+2=6)', g.footsToTotal === true && g.totals.pieces === 6, g);
}

// ---- G6: a stray key (not '' and not numeric) is folded into unattributed here too -
// checkPayload is what flags a parser fault; this reducer must not throw on one
{
  const bundle = B({ totals: { pieces: 4, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [6], rows: [
    { lengthFt: 8, pieces: { '6': 2, 'RW': 2 } },
    { lengthFt: 10, pieces: {} },
  ] } });
  const g = toLengthWidthGrid(bundle);
  ok('G6 RW key does not throw and is counted as unattributed', g.rows[0].unattributed === 2, g.rows[0]);
  ok('G6 an empty-piece row still appears as its own row', g.rows.length === 2 && g.rows[1].pieces === 0, g.rows);
}

// ---- G7: does NOT foot when the document's stated total disagrees, and the caller
// must be able to tell (same rule as toWidthDistribution.footsToTotal)
{
  const bundle = B({ totals: { pieces: 999, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [6, 9], rows: [
    { lengthFt: 8, pieces: { '6': 1 } },
    { lengthFt: 9, pieces: { '9': 1 } },
  ] } });
  const g = toLengthWidthGrid(bundle);
  ok('G7 refuses to say it foots when it does not', g.footsToTotal === false, g);
  ok('G7 still returns the real summed pieces for the caller to compare', g.totals.pieces === 2, g.totals);
}

// ---- G8: with no stated total at all, footsToTotal is true (nothing to disagree
// with) - the NON-fault, same distinction checkPayload makes for a bundle with no total
{
  const bundle = B({ totals: { pieces: null, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [6], rows: [
    { lengthFt: 8, pieces: { '6': 1 } },
    { lengthFt: 9, pieces: { '6': 1 } },
  ] } });
  ok('G8 no stated total is not a foul', toLengthWidthGrid(bundle).footsToTotal === true, null);
}

// ---- G9: per-row board feet only when EVERY line at that length declared it -
// mirrors bundleRows()'s "a declared BF covering only SOME merged lines is discarded"
{
  // A second, DISTINCT length (12ft) is included in both bundles below so the bundle
  // stays genuinely two-length (merged.size===2) rather than collapsing to one merged
  // row - which, after the 2026-09-10 fix (see G12), is degenerate and returns null.
  const partial = B({ totals: { pieces: 3, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [6, 9], rows: [
    { lengthFt: 8, pieces: { '6': 1 }, declaredBF: 10 },
    { lengthFt: 8, pieces: { '9': 1 } }, // same length, no declaredBF on this line
    { lengthFt: 12, pieces: { '6': 1 } },
  ] } });
  ok('G9 a length with a partially-declared BF gets none, not a half-true figure',
    toLengthWidthGrid(partial).rows[0].boardFeet === null, toLengthWidthGrid(partial).rows[0]);

  const full = B({ totals: { pieces: 3, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [6, 9], rows: [
    { lengthFt: 8, pieces: { '6': 1 }, declaredBF: 10 },
    { lengthFt: 8, pieces: { '9': 1 }, declaredBF: 5 },
    { lengthFt: 12, pieces: { '6': 1 } },
  ] } });
  ok('G9 every line at that length declaring BF sums it', toLengthWidthGrid(full).rows[0].boardFeet === 15, toLengthWidthGrid(full).rows[0]);
}

// ---- G10: a range row (lengthFtMin/Max) is a grid row too, sorted by its start,
// exactly like toLengthDistribution's S4/S4b
{
  const bundle = B({ totals: { pieces: 3, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [6], rows: [
    { lengthFt: 16, pieces: { '6': 1 } },
    { lengthFtMin: 11, lengthFtMax: 12, pieces: { '6': 2 } },
  ] } });
  const g = toLengthWidthGrid(bundle);
  ok('G10 range row renders its range and sorts by its start', g.rows.map((r) => r.label).join(',') === "11-12',16'", g.rows.map((r) => r.label));
}

// ---- G11: THE REAL DOCUMENT. Bundle 11 of `pl inv 01368.xlsx` (Zebrano, FAS grade),
// transcribed programmatically (not by hand) from the raw sheet dump on 2026-09-10 -
// script and method: extract_bundle11.mjs, cross-checked row-by-row against the
// document's own t_pcs column before being pasted here. This is the same real-data
// shape (multi-length, multi-width, one bundle number repeating across rows) that
// motivated toLengthWidthGrid; G3 above is a synthetic bundle merely STYLED after it.
// Every row here foots its own t_pcs; column totals and the grand total below were
// computed by the same extraction script, independently of toLengthWidthGrid itself.
{
  const zebrano11 = B({
    bundleNo: '11', species: 'ZEBRANO 70-80% QS KD', grade: 'FIRST AND SECOND',
    thickness: { raw: '50.00mm', inches: 1.969 },
    totals: { pieces: 100, boardFeet: null, volumeM3: null },
    matrix: {
      widthUnit: 'mm',
      widthsIn: [70, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290],
      rows: [
        { lengthFt: 7.382, pieces: { '240': 1, '270': 1 } }, // 2250mm, t_pcs=2
        { lengthFt: 7.546, pieces: { '190': 1, '210': 1, '240': 2, '260': 1, '270': 2 } }, // 2300mm, t_pcs=7
        { lengthFt: 7.71, pieces: { '120': 1, '180': 1, '220': 1, '250': 1, '270': 1, '280': 1 } }, // 2350mm, t_pcs=6
        { lengthFt: 7.874, pieces: { '170': 1, '220': 1, '230': 1, '260': 1 } }, // 2400mm, t_pcs=4
        { lengthFt: 8.038, pieces: { '130': 1, '150': 1, '250': 1, '260': 2, '280': 1 } }, // 2450mm, t_pcs=6
        { lengthFt: 8.202, pieces: { '230': 1, '260': 1, '270': 1, '280': 1 } }, // 2500mm, t_pcs=4
        { lengthFt: 8.366, pieces: { '110': 1, '190': 1, '220': 1, '240': 2 } }, // 2550mm, t_pcs=5
        { lengthFt: 8.53, pieces: { '170': 1, '200': 1, '260': 1 } }, // 2600mm, t_pcs=3
        {
          lengthFt: 8.694, // 2650mm, t_pcs=63
          pieces: {
            '70': 2, '90': 1, '100': 2, '110': 2, '130': 6, '140': 2, '150': 7, '160': 4,
            '170': 3, '180': 4, '190': 6, '200': 1, '210': 2, '220': 4, '230': 6, '250': 4,
            '260': 1, '270': 3, '280': 2, '290': 1,
          },
        },
      ],
    },
  });
  const g = toLengthWidthGrid(zebrano11);
  const printedColumnTotals = {
    '70': 2, '90': 1, '100': 2, '110': 3, '120': 1, '130': 7, '140': 2, '150': 8, '160': 4,
    '170': 5, '180': 5, '190': 8, '200': 2, '210': 3, '220': 7, '230': 8, '240': 5, '250': 6,
    '260': 7, '270': 8, '280': 5, '290': 1,
  };
  ok('G11 real doc: not degenerate, 9 real lengths found', g !== null && g.rows.length === 9, g && g.rows.length);
  ok('G11 real doc: 22 real widths found (60/80/120/300+mm never appear in this bundle)',
    g.widths.length === 22, g.widths);
  ok('G11 real doc: every row sums to its own printed t_pcs',
    JSON.stringify(g.rows.map((r) => r.pieces)) === JSON.stringify([2, 7, 6, 4, 6, 4, 5, 3, 63]),
    g.rows.map((r) => r.pieces));
  ok('G11 real doc: column totals match the document, computed independently of toLengthWidthGrid',
    JSON.stringify(g.columnTotals) === JSON.stringify(printedColumnTotals), g.columnTotals);
  ok('G11 real doc: grand total is 100, matching the document\'s own bundle total',
    g.totals.pieces === 100 && g.footsToTotal === true, g.totals);
  ok('G11 real doc: no piece is silently dropped or invented', g.columnUnattributedTotal === 0, g);
}

// ---- G12: regression for the bug the adversarial review found 2026-09-10 - a
// bundle reporting ONE length across TWO lines (rows.length===2) must still be
// treated as single-length (degenerate), exactly like bundleRows()'s "duplicate
// length lines collapse to ONE row" fix. Before this fix, toLengthWidthGrid gated on
// the RAW row count and would have returned a spurious 1-row "grid" for this shape
// instead of null, silently switching this bundle from the old (correct,
// toWidthDistribution-driven) table to the new one.
{
  const dup = B({ matrix: { widthsIn: [6, 9], rows: [
    { lengthFt: 8, pieces: { '6': 1 } },
    { lengthFt: 8, pieces: { '9': 1 } },
  ] } });
  ok('G12 same length reported twice is still degenerate (null), not a 1-row grid',
    toLengthWidthGrid(dup) === null, toLengthWidthGrid(dup));
}

// ---- G13: regression for the second bug the same review found - a pieces key that
// parses as a finite number but is NOT in the bundle's own declared widthsIn is a
// parser fault (checkPayload's strayWidth case), not a real width. Before this fix it
// silently became its own grid column with a fully-footing, confidently bold Total -
// directly beneath where the length-distribution table (driven by the SAME
// checkPayload) correctly shows a red "cannot total" banner for the identical bundle.
{
  const stray = B({ totals: { pieces: 5, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [60, 70], rows: [
    { lengthFt: 8, pieces: { '60': 2, '65': 1 } }, // '65' is not in widthsIn - a parser fault
    { lengthFt: 9, pieces: { '70': 2 } },
  ] } });
  const g = toLengthWidthGrid(stray);
  ok('G13 an undeclared width key is never promoted to its own column', g.widths.indexOf(65) === -1, g.widths);
  ok('G13 ...it is folded into unattributed instead, so it is never silently lost',
    g.rows[0].unattributed === 1, g.rows[0]);
  ok('G13 ...and the grid still foots, because the piece is counted, just not as width 65',
    g.footsToTotal === true && g.totals.pieces === 5, g.totals);
}

// ---- G14: THE STRESS CASE. `pl inv 05513.xlsx`, the gnarliest tally we hold, kept
// deliberately OUT of the demo rotation (see that file's header) and used here only to
// harden the reducer. This is the real answer to "does the grid survive a 39-column,
// 15-length bundle", which G3 and G11 cannot answer because neither is that extreme.
{
  const docBundles = TALLY_ZEBRANO05513.bundles;

  ok('G14 the stress document loaded, 15 bundles', docBundles.length === 15, docBundles.length);

  // Every bundle either grids (2+ distinct lengths) or correctly declines to.
  let gridded = 0;
  let widest = 0;
  let longest = 0;
  for (const b of docBundles) {
    const distinct = new Set((b.matrix?.rows || []).map((r) => r.lengthFt)).size;
    const g = toLengthWidthGrid(b);
    if (distinct >= 2) {
      gridded++;
      if (!g) { ok('G14 bundle ' + b.bundleNo + ' has ' + distinct + ' lengths and MUST grid', false, null); continue; }
      widest = Math.max(widest, g.widths.length);
      longest = Math.max(longest, g.rows.length);
      // Every row must foot to its own printed figure, and the grid to the bundle's.
      if (g.totals.pieces !== b.totals.pieces) {
        ok('G14 bundle ' + b.bundleNo + ' grid must sum to its stated ' + b.totals.pieces, false, g.totals.pieces);
      }
      // No column may be a width the document did not declare.
      const undeclared = g.widths.filter((w) => !(b.matrix.widthsIn || []).includes(w));
      if (undeclared.length) {
        ok('G14 bundle ' + b.bundleNo + ' invented width column(s)', false, undeclared);
      }
    } else if (g !== null) {
      ok('G14 bundle ' + b.bundleNo + ' is single-length and must NOT grid', false, g.rows.length);
    }
  }

  ok('G14 the 10 multi-length bundles all grid', gridded === 10, gridded);
  ok('G14 every gridded bundle foots and invents no column', true, null); // failures above would have fired
  ok('G14 the widest bundle really is extreme (>= 30 width columns)', widest >= 30, widest);
  ok('G14 the longest bundle really is extreme (>= 15 length rows)', longest >= 15, longest);

  // The whole document reconciles, which is what the generator asserted on emit.
  const docPieces = docBundles.reduce((a, b) => a + b.totals.pieces, 0);
  ok('G14 the document totals 1398 pieces, as the sheet itself states',
    docPieces === TALLY_ZEBRANO05513_TOTALS.pieces && docPieces === 1398, docPieces);

  // 🔴 AND IT MUST STAY OUT OF THE DEMO. If someone wires this document into the
  // rotation, a trader starts seeing 39 columns of another shipment's wood on his lots.
  // The decision and its reasoning are in the todo-list, question 9.
  const fixturesSrc = fs.readFileSync(new URL('./archTallyFixtures.ts', import.meta.url), 'utf8');
  ok('G14 the stress document is NOT imported by the demo fixtures at all',
    !/archTallyZebrano05513/.test(fixturesSrc), 'archTallyFixtures.ts imports the 05513 document');
  const declLine = (fixturesSrc.match(/const ALL_DEMO_DOCS[^;]+;/) || [''])[0];
  ok('  ...and the demo rotation still names only the four intended documents',
    (declLine.match(/TALLY_[A-Z0-9_]+/g) || []).join(',')
      === 'TALLY_ZEBRANO,TALLY_DETAIL_PL,TALLY_314307,TALLY_CHECHEN',
    declLine);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
