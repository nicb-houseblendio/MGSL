// The four things the V4 mockup shows that the shipped screen did not.
//
// 🔴 WHY THIS FILE EXISTS. `reference_arch_tally_matrix_shape.md` declared the tally
// UI "RESOLVED 2026-09-11". Only the placement half had shipped. The mockup,
// `MGSL Trader Screen V4 (offline) (2).html`, is working React sitting in the repo,
// and it specifies four more things: the matrix inline and EXPANDED BY DEFAULT, a
// length-range filter that also hides lots with nothing in range, LENGTHS chips and
// an AVG WIDTH column per lot row, and BF alongside PCS in the grid.
//
// These pin the arithmetic against the mockup's own functions, quoted where it matters.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lengthDisplayRow } from '@/lib/archTallyLength';
import { toLengthWidthGrid, filterGridByLength, bundleLengthChips, bundleLengthBounds }
  from '@/lib/archTally';

const here = dirname(fileURLToPath(import.meta.url));
let fail = 0, total = 0;
const ok = (name, cond, got) => {
  total++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};
const near = (a, b, tol = 0.05) => a != null && Math.abs(a - b) <= tol;

/* A bundle shaped like the mockup's lot 001: several lengths, several widths. */
const bundle = {
  bundleNo: 'T1', lot: 'LOT-1', species: 'European White Oak',
  thickness: { raw: '4/4', inches: 1 },
  matrix: {
    widthsIn: [6, 8],
    rows: [
      { lengthFt: 6,  pieces: { '6': 10, '8': 2 },  declaredBF: 60 },
      { lengthFt: 9,  pieces: { '6': 4,  '8': 4 },  declaredBF: 48 },
      { lengthFt: 12, pieces: { '6': 2,  '8': 8 },  declaredBF: 90 },
    ],
  },
  totals: { pieces: 30, boardFeet: 198, volumeM3: null },
};
const g = toLengthWidthGrid(bundle);

/* ── AVG WIDTH ─────────────────────────────────────────────────────────────── */
// The mockup: wWeighted += w*p across every cell, then avgW = wWeighted/totPcs.
// Here: 6*(10+4+2) + 8*(2+4+8) = 96 + 112 = 208 over 30 pieces = 6.93.
ok('avgWidth is piece-WEIGHTED, as the mockup computes it', near(g.avgWidth, 208 / 30), g.avgWidth);
ok('  ...not a plain mean of the width columns, which would be 7.0',
  !near(g.avgWidth, 7.0, 0.01), g.avgWidth);

const lopsided = toLengthWidthGrid({
  ...bundle,
  matrix: { widthsIn: [6, 12], rows: [
    { lengthFt: 8, pieces: { '6': 100 } }, { lengthFt: 10, pieces: { '12': 1 } }] },
  totals: { pieces: 101, boardFeet: null, volumeM3: null },
});
ok('  ...so 100 six-inch boards and one twelve-inch average 6.1, not 9',
  near(lopsided.avgWidth, (6 * 100 + 12) / 101), lopsided.avgWidth);

const unattr = toLengthWidthGrid({
  ...bundle,
  matrix: { widthsIn: [6], rows: [
    { lengthFt: 8, pieces: { '6': 10, RW: 90 } }, { lengthFt: 10, pieces: { '6': 10 } }] },
  totals: { pieces: 110, boardFeet: null, volumeM3: null },
});
// Counting the 90 random-width pieces at width zero would report 0.5 inches.
ok('unattributed pieces are EXCLUDED from avgWidth, not counted at width zero',
  near(unattr.avgWidth, 6), unattr.avgWidth);

/* ── BF PER COLUMN ─────────────────────────────────────────────────────────── */
// Row BF is one figure for the row, so a column takes its share of the pieces.
// Width 6: 60*(10/12) + 48*(4/8) + 90*(2/10) = 50 + 24 + 18 = 92.
ok('column BF is apportioned by the column share of each row\'s pieces',
  near(g.columnBoardFeet['6'], 92, 0.5), g.columnBoardFeet['6']);
ok('  ...and the columns sum to the stated row BF total',
  near((g.columnBoardFeet['6'] || 0) + (g.columnBoardFeet['8'] || 0), 198, 0.5),
  [g.columnBoardFeet['6'], g.columnBoardFeet['8']]);

const noBF = toLengthWidthGrid({
  ...bundle,
  matrix: { widthsIn: [6, 8], rows: [
    { lengthFt: 6, pieces: { '6': 5, '8': 5 } }, { lengthFt: 9, pieces: { '6': 5, '8': 5 } }] },
  totals: { pieces: 20, boardFeet: null, volumeM3: null },
});
// The file's contract: a BF figure computed from dimensions would disagree with the paper.
ok('a column with no stated BF stays NULL, never derived from dimensions',
  noBF.columnBoardFeet['6'] === null && noBF.columnBoardFeet['8'] === null,
  noBF.columnBoardFeet);

/* ── LENGTH RANGE ──────────────────────────────────────────────────────────── */
const f = filterGridByLength(g, 8, 12);
ok('filtering by length keeps only the rows in range', f.rows.length === 2,
  f.rows.map((r) => r.label));
// The mockup rebuilds colPcs/colBF/totPcs/avgW from the filtered rows for this reason.
ok('TOTALS ARE RECOMPUTED, so the footer cannot count rows that are not shown',
  f.totals.pieces === 18, f.totals.pieces);
ok('  ...column totals too: width 6 drops from 16 to 6',
  g.columnTotals['6'] === 16 && f.columnTotals['6'] === 6,
  [g.columnTotals['6'], f.columnTotals['6']]);
ok('  ...and avgWidth is recomputed for what survives',
  !near(f.avgWidth, g.avgWidth, 0.01), [g.avgWidth, f.avgWidth]);
/* 🔴 A FILTERED GRID STILL FOOTS, and getting this wrong shipped a real bug.
   `footsToTotal` false makes the panel print "the document states N pieces but this
   grid sums to M", which blames the supplier's paperwork for the trader moving a
   slider. Every expanded matrix on screen lost its totals at once. A filtered view
   is not a broken document: it foots to ITS OWN rows, and `isFiltered` is what tells
   the panel to label the row SHOWN rather than TOTAL. */
ok('a filtered grid FOOTS, so no false data-error banner is raised',
  f.footsToTotal === true && f.isFiltered === true, [f.footsToTotal, f.isFiltered]);
// 9' and 12' survive: 48 + 90.
ok('  ...and its BF is summed from the surviving rows, not the bundle total',
  f.totals.boardFeet === 138, f.totals.boardFeet);
ok('  ...while an unfiltered grid is not marked filtered', g.isFiltered === false);
ok('a range covering everything returns the grid UNCHANGED, same object',
  filterGridByLength(g, 0, 999) === g);
ok('an empty range yields no rows rather than throwing',
  filterGridByLength(g, 100, 200).rows.length === 0);
ok('filtering null is null, not a crash', filterGridByLength(null, 1, 2) === null);

/* ── LOT ROW SUMMARY ───────────────────────────────────────────────────────── */
ok('length chips are the distinct lengths, in document order',
  JSON.stringify(bundleLengthChips(bundle)) === JSON.stringify(["6'", "9'", "12'"]),
  bundleLengthChips(bundle));
ok('bounds give the clamp for a range control',
  JSON.stringify(bundleLengthBounds(bundle)) === JSON.stringify({ lo: 6, hi: 12 }),
  bundleLengthBounds(bundle));
ok('a bundle with no matrix has no chips and no bounds',
  bundleLengthChips({ matrix: null }).length === 0 && bundleLengthBounds({ matrix: null }) === null);

/* ── the components actually use them ──────────────────────────────────────── */
const lotTable = fs.readFileSync(join(here, '..', 'components', 'arch', 'ArchLotTable.tsx'), 'utf8');
const dialog   = fs.readFileSync(join(here, '..', 'components', 'arch', 'TallyImageDialog.tsx'), 'utf8');
/* The default is per-lot, not global: OPEN for a lot that has a matrix, CLOSED for one
   that does not, which is what the prototype does. Storing the delta from that default
   is the only way one Set can express both. Asserting on `toggledTally` pins the shape,
   and the XOR pins the rule. */
ok('SOURCE: the lot table stores the DELTA from a per-lot default, not a flat expanded set',
  /toggledTally/.test(lotTable) && !/collapsedTally/.test(lotTable) && !/expandedTally/.test(lotTable));
ok('SOURCE: ...and a lot is open iff it has a matrix XOR the trader toggled it',
  /hasMatrix !== toggledTally\.has\(lotNo\)/.test(lotTable));
ok('SOURCE: an untallied lot therefore never paints an expanded "no tally" row on load',
  /isTallyExpanded\(lot\.lotNo, hasMatrix\) && \(\(\) =>/.test(lotTable));
/* gap 4: the length slider has to move the lot row's own BF, or it reads as inert
   while the matrix under it already changed. */
ok("SOURCE: TOTAL BF follows the length filter, off the lot's own tally",
  /const filteredBF = fg && fg\.isFiltered \? fg\.totals\.boardFeet : null;/.test(lotTable));
ok('SOURCE: ...and says which of the two figures is on screen',
  /the boards inside the length filter, off this lot's tally/.test(lotTable) &&
  /NetSuite's quantity for this bundle/.test(lotTable));
ok('SOURCE: the lot row shows length chips and average width',
  /bundleLengthChips/.test(lotTable) && /avgWidth/.test(lotTable));
ok('SOURCE: a length range filters the grid', /filterGridByLength/.test(lotTable));
/* 🔴 The prototype's header LABELS are sentence case - `Long.`, `Pcs`, `BF` - and it is
   `textTransform:"uppercase"` on hdrCell that renders them as LONG./PCS/BF. An earlier
   pass typed the shouted form into the JSX and left the transform off, which looks the
   same in that one cell and diverges the moment anyone restyles the header. Assert BOTH
   halves: the literal the prototype writes, and the transform that shouts it. */
ok('SOURCE: the grid header is Long. ... Pcs, BF, verbatim from the prototype',
  />Long\.<\/th>/.test(dialog) && />Pcs<\/th>/.test(dialog) && />BF<\/th>/.test(dialog));
ok('SOURCE: ...and the header shouts them with textTransform, as the prototype does',
  /const gHead: React\.CSSProperties = {[\s\S]*?textTransform: 'uppercase'[\s\S]*?};/.test(dialog));
/* The prototype's footer is ONE row ending in total PCS then total BF. An earlier
   pass added a per-width BF row that exists nowhere in the prototype. */
ok('SOURCE: there is no invented per-width BF row', !/Board feet DOWN each width column/.test(dialog));
ok('SOURCE: a filtered grid is labelled Shown, not Total',
  /grid\.isFiltered \? 'Shown' : 'Total'/.test(dialog));
ok('SOURCE: the length control is the prototype dual-thumb slider, not number boxes',
  /LengthRangeSlider/.test(lotTable) && /onPointerDown={startDrag/.test(lotTable) &&
  /transform: 'translate\(-50%,-50%\)'/.test(lotTable));


/* ── the prototype's own grid chrome, gap by gap (2026-09-15) ───────────────────
   Every one of these was MISSING when the client opened the screen next to the
   prototype and said it did not match. They are source-text assertions because
   `react-app` has no jsdom or RTL; see the file header. */
ok('SOURCE: the grid palette is the prototype\'s C, transcribed',
  /navy: '#0F2641'/.test(dialog) && /green: '#1E6B47'/.test(dialog) &&
  /rowAlt: '#F8FAFC'/.test(dialog) && /footBg: '#F1F5FA'/.test(dialog));
ok('SOURCE: body rows zebra on the row index, as the prototype does',
  /ri % 2 === 0 \? '#fff' : GC\.rowAlt/.test(dialog));
ok('SOURCE: width cells are CENTRED, not right aligned',
  /\.\.\.gCell, textAlign: 'center',\s*\n\s*color: p \? GC\.text : GC\.border/.test(dialog));
ok('SOURCE: internal grid lines exist and are lighter than the outer ones (the 88 alpha)',
  /borderRight: '1px solid ' \+ GC\.borderLight \+ '88'/.test(dialog));
ok('SOURCE: Pcs is fenced off from the widths by a full-weight left border',
  /borderLeft: '1px solid ' \+ GC\.border/.test(dialog));
ok('SOURCE: the header is the prototype gradient with a 2px rule under it',
  /linear-gradient\(to bottom,#F1F5FA,#E8EDF5\)/.test(dialog) &&
  /borderBottom: '2px solid ' \+ GC\.border/.test(dialog));
ok('SOURCE: the footer is 9.5px uppercase over a 2px rule',
  /fontSize: 9\.5, letterSpacing: 0\.5, textTransform: 'uppercase'/.test(dialog) &&
  /borderTop: '2px solid ' \+ GC\.border/.test(dialog));
ok('SOURCE: the TOTAL BF is the only green in the grid, at weight 800',
  /fontWeight: 800, color: GC\.green/.test(dialog) &&
  (dialog.match(/GC\.green/g) || []).length === 1);
ok('SOURCE: the grid fills its row (width 100%) and aligns digits without a mono face',
  /width: '100%', borderCollapse: 'separate', borderSpacing: 0/.test(dialog) &&
  /fontVariantNumeric: 'tabular-nums'/.test(dialog));
/* The prototype's expanded row is the matrix and nothing else. Our caption is extra,
   so it may only appear where the panel opens away from the lot's own row. */
ok('SOURCE: the inline expansion carries no caption the prototype does not have',
  /{!hideDistribution && \(/.test(dialog));

/* ── gap 6: a single-length bundle is still a matrix ──────────────────────────
   The seeded lot 315643-14-B is one length at one width. Before this, the grid
   returned null (two distinct lengths required) AND the width table suppressed
   itself (one width is degenerate), so the caret opened onto an empty panel. The
   prototype draws a one-row matrix with a Total under it. */
{
  const single = {
    bundleNo: '14-B', lot: '315643-14-B', species: 'Purpleheart',
    thickness: { raw: '4/4', inches: 1 },
    matrix: { widthsIn: [6], rows: [{ lengthFt: 8, pieces: { '6': 48 }, declaredBF: 192 }] },
    totals: { pieces: 48, boardFeet: 192, volumeM3: null },
  };
  ok('gap 6: the default call still refuses a single length, so nothing shipped changes',
    toLengthWidthGrid(single) === null, toLengthWidthGrid(single));
  const sg = toLengthWidthGrid(single, { allowSingleLength: true });
  ok('gap 6: ...and the opt-in gives the prototype one-row matrix',
    sg !== null && sg.rows.length === 1 && sg.widths.length === 1, sg);
  ok('gap 6: ...that foots, so it prints a Total rather than a red banner',
    sg.footsToTotal === true && sg.totals.pieces === 48, sg && sg.totals);
  ok('gap 6: ...with the BF the document stated',
    near(sg.totals.boardFeet, 192, 0.5), sg && sg.totals);
  /* The "same length on two lines" shape stays degenerate on the DEFAULT call - G12
     in archTallyGrid.test.mjs - but merges to one real row under the opt-in rather
     than to two. Merging is the point; the row count is the check. */
  const dup = {
    bundleNo: 'D', lot: 'L', species: 'X', thickness: { raw: '4/4', inches: 1 },
    matrix: { widthsIn: [6, 9], rows: [
      { lengthFt: 8, pieces: { '6': 1 } },
      { lengthFt: 8, pieces: { '9': 1 } },
    ] },
    totals: { pieces: 2, boardFeet: null, volumeM3: null },
  };
  const dg = toLengthWidthGrid(dup, { allowSingleLength: true });
  ok('gap 6: two lines at one length merge to ONE row under the opt-in, never two',
    dg !== null && dg.rows.length === 1 && dg.totals.pieces === 2, dg && dg.rows);
  ok('gap 6: a bundle with no matrix at all is still null, opt-in or not',
    toLengthWidthGrid({ matrix: null }, { allowSingleLength: true }) === null);
  ok('gap 6: ...and so is an empty rows array',
    toLengthWidthGrid({ matrix: { widthsIn: [], rows: [] } }, { allowSingleLength: true }) === null);
}
/* Both components must pass the SAME option, or the caret and the panel disagree. */
ok('SOURCE: the lot table and the panel agree on allowSingleLength',
  /const GRID_OPTS = { allowSingleLength: true } as const;/.test(lotTable) &&
  !/toLengthWidthGrid\(lotBundle\(lot\)\)/.test(lotTable) &&
  /toLengthWidthGrid\(bundle, { allowSingleLength: true }\)/.test(dialog));



/* ── metric lengths must read the same in the chip as in the grid (2026-09-15) ──
   Found by clicking the deployed screen: lot 315604-5's row printed chips "7.874′
   8.53′" while the matrix one line below printed "2400mm" and "2600mm" for the same
   boards. Both come from the document; only one is readable. */
{
  const metric = {
    bundleNo: 'M', lot: 'L', species: 'Zebrano', thickness: { raw: '4/4', inches: 1 },
    matrix: { widthsIn: [6], rows: [
      { lengthFt: 7.874, pieces: { '6': 4 } },
      { lengthFt: 8.53,  pieces: { '6': 3 } },
    ] },
    totals: { pieces: 7, boardFeet: null, volumeM3: null },
  };
  const chips = bundleLengthChips(metric);
  ok('metric chips print millimetres, not decimal feet',
    chips.length === 2 && chips.every((c) => /mm$/.test(c)), chips);
  const mg = toLengthWidthGrid(metric, { allowSingleLength: true });
  ok('...and the chip text equals the grid row text, board for board',
    JSON.stringify(chips) === JSON.stringify(mg.rows.map((r) => lengthDisplayRow(r).text)),
    [chips, mg.rows.map((r) => lengthDisplayRow(r).text)]);
  const imperial = {
    bundleNo: 'I', lot: 'L', species: 'Oak', thickness: { raw: '4/4', inches: 1 },
    matrix: { widthsIn: [6], rows: [{ lengthFt: 8, pieces: { '6': 4 } }, { lengthFt: 12, pieces: { '6': 3 } }] },
    totals: { pieces: 7, boardFeet: null, volumeM3: null },
  };
  ok('an imperial document is left exactly as it prints',
    JSON.stringify(bundleLengthChips(imperial)) === JSON.stringify(["8'", "12'"]),
    bundleLengthChips(imperial));
}
/* The slider only ever reports whole feet (valFromX rounds, both boxes parseInt), so
   a bound it can never return to is a bound the trader cannot undo. */
ok('SOURCE: the slider bounds are whole feet',
  /const flo = Math\.floor\(lo\), fhi = Math\.ceil\(hi\);/.test(lotTable));
ok('SOURCE: the lot row chips use the metric display too',
  /fg\.rows\.map\(\(r\) => lengthDisplayRow\(r\)\.text\)/.test(lotTable));
ok('SOURCE: a filter with no BF to show says so rather than looking inert',
  /this lot's tally states no board feet for the lengths in the filter/.test(lotTable));



/* Found by diffing computed styles against the running prototype, not by reading code:
   one shared footer style shrank the TOTAL numbers to the label's 9.5px uppercase. */
ok('SOURCE: only the footer LABEL is 9.5px uppercase, the totals keep body size',
  /const gFoot: React\.CSSProperties = {\s*\n\s*padding: '6px 8px', whiteSpace: 'nowrap',\s*\n\s*borderTop:/.test(dialog) &&
  /const gFootLabel: React\.CSSProperties = {[\s\S]{0,160}?fontSize: 9\.5, letterSpacing: 0\.5, textTransform: 'uppercase'/.test(dialog) &&
  /\.\.\.gFootLabel, textAlign: 'left'/.test(dialog));



/* Found only in a SCREENSHOT: every DOM assertion passed while 600px of the lot table,
   TOTAL BF and BF COST included, sat off the right edge of the drawer. */
ok('SOURCE: the matrix cannot inflate the lot table that contains it',
  /width: 0, minWidth: '100%', overflow: 'auto'/.test(dialog));



/* ── the fixture gate is wired, not just written (2026-09-15) ─────────────────
   The gate is worthless if a component forgets to pass the flag, and there is no
   jsdom here to catch that at runtime, so the wiring is pinned as source text. */
const reserved = fs.readFileSync(join(here, '..', 'components', 'arch', 'ArchReservedSection.tsx'), 'utf8');
const drawer   = fs.readFileSync(join(here, '..', 'components', 'DetailDrawerARCH.tsx'), 'utf8');
const screen   = fs.readFileSync(join(here, '..', 'components', 'ArchScreen.tsx'), 'utf8');
ok('SOURCE: the lot table derives allowFixture from the explicit data source, once',
  /const allowFixture = dataSource === 'fixtures';/.test(lotTable));
ok('SOURCE: ...and every demoTallyProps call in the lot table passes it',
  (lotTable.match(/demoTallyProps\(/g) || []).length === 3 &&
  !/demoTallyProps\(lot\.lotNo, lot\.tally, lot\.tallyState\)/.test(lotTable));
ok('SOURCE: the reserved panel is handed the same answer, not its own',
  /allowFixture\?: boolean;/.test(reserved) && /allowFixture = false,/.test(reserved) &&
  /allowFixture={allowFixture}/.test(lotTable));
ok('SOURCE: the drawer forwards the source and defaults to the truthful reading',
  /dataSource\?: ArchDataSource;/.test(drawer) && /dataSource = 'netsuite',/.test(drawer) &&
  /dataSource={dataSource}/.test(drawer));
ok('SOURCE: and ArchScreen supplies the real signal it already computes',
  /dataSource={source}/.test(screen));



/* ── adversarial review, 2026-09-15 ────────────────────────────────────────── */

/* R1 (HIGH). `MAX(sn.date)` came back as '9/15/2026', date only. `new Date()` reads
   that as midnight, so every payload change was backdated by up to 24 hours and the
   "precise" path became LESS precise than the `lastmodified` fallback it narrowed.
   Live consequence: lot 315643-6 split at 00:34:14, payload rewritten at 02:19:35 the
   same morning, and the screen called the fresh tally stale. */
{
  const mr = fs.readFileSync(join(here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts',
    'mcgi_services', 'trader_screen', 'entry_points', 'mr',
    'mcgi_mr_trader_screen_cache_arch.js'), 'utf8');
  ok('R1: the payload-change query carries a TIME, not just a date',
    /TO_CHAR\(MAX\(sn\.date\),'YYYY-MM-DD HH24:MI:SS'\) AS changedat/.test(mr));
  ok('R1: ...and the bare MAX(sn.date) form is gone',
    !/MAX\(sn\.date\) AS changedat/.test(mr));
  /* The arithmetic the bug turned on, so the regression is a number and not a regex. */
  const split = new Date('2026-09-15 00:34:14');
  ok('R1: truncated to midnight the split looks NEWER than the re-tally (the bug)',
    split.getTime() > new Date('2026-09-15').getTime());
  ok('R1: with the real time it correctly looks OLDER (the fix)',
    split.getTime() < new Date('2026-09-15 02:19:35').getTime());

  /* R3 (MEDIUM). A split CHILD carrying a tally older than its own creation fell into
     the parent arm and was labelled "this bundle was split", which is the wrong noun
     and the wrong remedy: a parent needs re-measuring, a child was never measured. */
  ok('R3: role decides the label before any timestamp does',
    /if \(split\.role === 'child'\) \{/.test(mr) &&
    /const childStamp = tally/.test(mr));
  ok('R3: ...so newChild no longer requires the absence of a tally',
    !/split\.role === 'child' && !tally/.test(mr));

  /* R5 (LOW). 67 rows today, no cap and no date bound, in a job that runs hourly
     forever. Newest-first, so silence would drop the OLDEST splits — the same failure
     TALLY_MAX had before its status filter moved into SQL. */
  ok('R5: the split scan is capped and says so when the cap bites',
    /const SPLIT_MAX = \d+;/.test(mr) && /ARCH split scan hit its row cap/.test(mr) &&
    /i < rows\.length && i < SPLIT_MAX/.test(mr));
}

/* R2 (HIGH). The length filter survived a bucket switch: this component is not
   remounted when the drawer changes tab, so the range outlived the lots it was set
   against. Live: filter Ready to Build to 12′, switch to On Hand, header says 23
   bundles, table draws 21, both thumbs pinned at 100%. Stock withheld by a control
   that reads as wide open. */
ok('R2: the range is cleared when the bucket changes',
  /React\.useEffect\(\(\) => \{ setLengthRange\(null\); \}, \[bucket\]\);/.test(lotTable));
ok('R2: ...and a surviving range is clamped to the lots actually on screen',
  /const effectiveRange = React\.useMemo/.test(lotTable) &&
  /const lo = Math\.max\(lengthRange\.lo, lengthBounds\.lo\);/.test(lotTable) &&
  /return hi >= lo \? \{ lo, hi \} : null;/.test(lotTable));
ok('R2: ...so a range that cannot overlap hides NOTHING rather than everything',
  /if \(!effectiveRange\) return true;/.test(lotTable));
ok('R2: ...and every consumer reads the clamped range, the slider included',
  !/lengthRange\.lo, lengthRange\.hi/.test(lotTable) &&
  /lo=\{effectiveRange\?\.lo \?\? lengthBounds\.lo\}/.test(lotTable) &&
  /lengthRange=\{effectiveRange\}/.test(lotTable));

console.log(total + ' assertions, ' + (fail ? fail + ' FAILED' : 'all passed'));
if (fail) process.exit(1);
