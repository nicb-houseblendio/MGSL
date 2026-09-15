/**
 * CAN A TRADER ACTUALLY SEE THE WIDTH MATRIX? Measured over the real lot numbers.
 *
 * ── THE COMPLAINT THIS TEST EXISTS TO CLOSE ──────────────────────────────────
 * Marc-Antoine Poirier, 2026-09-08, and it was his most important point:
 *
 *   "La matrice pour présenter le tally qui sera feedé par le custom record
 *    n'est pas présent."
 *
 * The width matrix was built, tested and deployed. It was also unreachable. Both
 * documents in the demo rotation were DEGENERATE for width - TALLY_314307's bundles
 * carry the single width 5.5", TALLY_CHECHEN is `widthPolicy: 'randomWidth'` with no
 * widths at all - so `toWidthDistribution().degenerate` was true on every bundle the
 * screen could serve and TallyImageDialog rendered nothing. The one real multi-width
 * document was reachable only by typing MCGI_CONFIG.tallyDemoDoc = 'detail-pl' into
 * the browser console. From the client's chair the feature did not exist.
 *
 * Measured before the fix, over the lot numbers below: 67 sample banners, and 0
 * non-degenerate width grids.
 *
 * ── WHY THE LOT NUMBERS ARE REAL AND HARD-CODED ──────────────────────────────
 * The demo bundle is chosen by a hash of the lot NUMBER, so which document a trader
 * gets depends on the exact strings in the account. A synthetic list ('lot-1',
 * 'lot-2') tests the hash, not the screen. These are the ARCH lots carrying stock in
 * the sandbox on 2026-09-08:
 *
 *   node sql.mjs "SELECT inv.inventorynumber AS lotno, SUM(inl.quantityonhand) AS qoh
 *                 FROM inventorynumber inv
 *                 JOIN inventorynumberlocation inl ON inl.inventorynumber = inv.id
 *                 WHERE inv.item IN (2912,2913,2914,2915,2916,2917)
 *                   AND inl.quantityonhand <> 0
 *                 GROUP BY inv.inventorynumber"
 *
 * The six item ids are `SELECT id FROM item WHERE cseg_subsidiary_loc = 1` - the ARCH
 * subsidiary-location segment, which is how the trader screen scopes hardwood.
 * ⚠️ `inventoryitemlocations` (plural, the table the query was first written against)
 * returns 0 rows and 500s when joined in this tenant; `inventorynumberlocation` is
 * the one carrying per-lot on-hand. Note also that `cseg_subsidiary_loc` does not
 * exist in PRODUCTION - the segment has a different id there - so this list is a
 * sandbox measurement and is labelled as one.
 *
 * These are DATA, not a contract: refreshing the sandbox changes them. What must not
 * change is the assertion - every lot a trader can click draws a width grid.
 */
import { demoTallyProps, demoTallyForLot } from './archTallyFixtures.ts';
import { toWidthDistribution, toLengthDistribution, toLengthWidthGrid } from './archTally.ts';
import { lengthDisplayRow } from './archTallyLength.ts';

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

/** ARCH lots with on-hand stock, sandbox, 2026-09-08. 67 of them. */
const REAL_ARCH_LOTS = [
  '312494-1', '312502-3', '314000-10', '314000-13', '314000-3', '314000-7',
  '314279-1', '314544-13', '314649-5', '315093-23', '315093-24', '315093-25',
  '315093-26', '315093-27-B', '315093-30', '315093-31', '315093-32', '315604-1',
  '315604-10', '315604-11', '315604-12', '315604-13', '315604-14', '315604-15',
  '315604-2', '315604-3', '315604-4', '315604-5', '315604-6', '315643-10',
  '315643-13', '315643-14', '315643-18', '315643-19', '315643-2', '315643-20',
  '315643-21', '315643-5', '315643-6', '315643-7', '315970-1', '315970-10',
  '315970-11', '315970-12', '315970-2', '315970-3', '315970-4', '315970-5',
  '315970-6', '315970-7', '315970-8', '315970-9-B', '316027-1', '316027-10',
  '316027-11', '316027-12', '316027-2', '316027-3-B', '316027-4-B', '316027-6-B',
  '316027-7-B', '316027-9', '316125-31', '316125-32', '316125-33', '414983',
  'no name A-2',
];

// The deployed default: nothing typed into the console. This is the state the client
// is in when he opens the dialog.
{
  const g = globalThis;
  const had = Object.prototype.hasOwnProperty.call(g, 'window');
  if (!had) g.window = {};
  delete g.window.MCGI_CONFIG;

  ok('the lot list is the 67 measured on 2026-09-08', REAL_ARCH_LOTS.length === 67, REAL_ARCH_LOTS.length);

  /* 🔴 `true` IS THE FIXTURE GATE, ADDED 2026-09-15, AND THIS WHOLE BLOCK IS NOW
   * ABOUT DEMO MODE ONLY.
   *
   * Every assertion below measures how far the demo fixture reaches, which is a
   * question that only exists when the screen is running on local fixtures. On a
   * screen reading the real ARCH cache the fixture is not served at all, and the
   * block immediately after this one pins that instead.
   *
   * These were NOT deleted. "Every lot a trader can click draws a width grid" is
   * still the contract for the demo, and it is still the thing the client complained
   * about; it just stopped being the contract for live data, where a lot with no
   * tally now says so rather than borrowing another shipment's. */
  const seen = REAL_ARCH_LOTS.map((lot) => {
    const p = demoTallyProps(lot, null, null, true);
    return { lot, p, w: p.bundle ? toWidthDistribution(p.bundle) : null };
  });

  const noBundle = seen.filter((s) => !s.p.bundle).map((s) => s.lot);
  ok('IN DEMO MODE: every real lot still gets a bundle', noBundle.length === 0, noBundle);

  /* 🔴 THE ASSERTION THE CLIENT'S COMPLAINT REDUCES TO.
   * Before the fix this was 0 of 67. It must be 67 of 67: whichever lot he clicks,
   * the row-per-width table draws. */
  const degenerate = seen.filter((s) => !s.w || s.w.degenerate).map((s) => s.lot);
  ok('IN DEMO MODE: EVERY real lot renders a NON-degenerate width grid', degenerate.length === 0,
    { degenerateCount: degenerate.length, of: seen.length, examples: degenerate.slice(0, 6) });

  const thin = seen.filter((s) => s.w.rows.length < 2).map((s) => [s.lot, s.w.rows.length]);
  ok('  ...with at least two width rows, so it reads as a distribution', thin.length === 0, thin);

  /* 🔴 AND THE BANNER IS STILL THERE. This is fixture data from another shipment. If
   * making the matrix visible ever costs the sample banner, the screen has started
   * lying to a trader about whose numbers these are, and that is worse than the
   * matrix being invisible. */
  const unlabelled = seen.filter((s) => !s.p.sample).map((s) => s.lot);
  ok('every one of them still carries the "not this lot\'s document" sample banner',
    unlabelled.length === 0, unlabelled);
  const unnamed = seen.filter((s) => !s.p.sample?.sourceFile).map((s) => s.lot);
  ok('  ...and the banner names the source document', unnamed.length === 0, unnamed);
  ok('  ...and no lot gets a `source` line, which is reserved for real parsed data',
    seen.every((s) => !s.p.source), null);

  // The clicked bundle must be findable by identity: the dialog marks its row that way,
  // and refuses to total the set when it cannot find it.
  ok('the clicked bundle is inside its own siblings on every lot',
    seen.every((s) => Array.isArray(s.p.siblings) && s.p.siblings.indexOf(s.p.bundle) >= 0), null);

  // Deterministic, so a screenshot reproduces and two tables on one screen agree.
  ok('two calls for the same lot give the same bundle',
    REAL_ARCH_LOTS.every((lot) =>
      demoTallyProps(lot, null, null, true).bundle === demoTallyProps(lot, null, null, true).bundle), null);
  ok('demoTallyProps agrees with demoTallyForLot while nothing is configured',
    REAL_ARCH_LOTS.every((lot) =>
      demoTallyProps(lot, null, null, true).bundle === demoTallyForLot(lot).bundle), null);

  /* ── THE GATE ITSELF. The same 67 lots, called the way the deployed screen calls
   * them: no fourth argument, because the screen is reading the real cache.
   *
   * 771 of the 820 ARCH lots have no tally. Every one of them used to draw a
   * stranger's matrix under a "not this lot's document" banner. Honest, and still
   * four columns of pieces nobody counted for this wood. */
  const live = REAL_ARCH_LOTS.map((lot) => ({ lot, p: demoTallyProps(lot) }));
  const leaked = live.filter((x) => x.p.bundle).map((x) => x.lot);
  ok('CONNECTED: not one lot without a tally of its own gets a fixture bundle',
    leaked.length === 0, leaked);
  ok('CONNECTED: ...and none of them gets a sample banner either, since there is no sample',
    live.every((x) => !x.p.sample), live.filter((x) => x.p.sample).map((x) => x.lot));
  ok('CONNECTED: ...nor a `source` line, which is reserved for real parsed data',
    live.every((x) => !x.p.source), null);
  ok('CONNECTED: siblings is an empty array, not undefined, so the panel can spread it',
    live.every((x) => Array.isArray(x.p.siblings) && x.p.siblings.length === 0), null);

  /* REAL data is unaffected by the gate. This is the half that must not regress:
   * the gate withholds fixtures, never a lot's own parsed tally. */
  const realBundle = {
    bundleNo: '1', lot: '315643-5', species: 'Purpleheart',
    thickness: { raw: '4/4', inches: 1 },
    matrix: { widthsIn: [6, 8], rows: [
      { lengthFt: 8, pieces: { '6': 32, '8': 32 }, declaredBF: 298.7 },
      { lengthFt: 10, pieces: { '6': 32, '8': 32 }, declaredBF: 373.3 },
    ] },
    totals: { pieces: 128, boardFeet: 672, volumeM3: null },
  };
  const withReal = demoTallyProps('315643-5',
    { status: 'PARSED', sourceFile: 'SEED.json', docUrl: null, bundles: [realBundle] });
  ok('CONNECTED: a lot WITH a parsed tally still gets it, gate or no gate',
    withReal.bundle === realBundle, null);
  ok('CONNECTED: ...and it still carries its provenance, and still no sample banner',
    withReal.source?.sourceFile === 'SEED.json' && withReal.sample === undefined, withReal.source);

  /* The split states were already refused ahead of everything else. Re-pinned here so
   * the gate cannot be "simplified" into replacing them. */
  ok('CONNECTED: a split parent is still refused even with the fixture allowed',
    demoTallyProps('315643-6', null, 'staleParent', true).bundle === undefined, null);
  ok('CONNECTED: ...and so is a split child',
    demoTallyProps('315643-6-B', null, 'newChild', true).bundle === undefined, null);

  /* 🔴 THE REASON THE MATRIX WAS HIDDEN IN THE FIRST PLACE, now measured rather than
   * assumed. The multi-width document is metric, so through rowLabel() its lengths
   * print as 7.874'. That is what kept it out of the rotation. It has to be readable
   * on the way in, or the fix trades one unreadable panel for another. */
  const badLengths = [];
  for (const s of seen) {
    for (const r of toLengthDistribution(s.p.siblings).rows) {
      const d = lengthDisplayRow(r);
      if (/\.\d+'/.test(d.text)) badLengths.push([s.lot, r.label, d.text]);
    }
  }
  ok('no length cell on any real lot prints a fractional foot', badLengths.length === 0,
    badLengths.slice(0, 6));

  /* ── THE TWO-AXIS GRID, added 2026-09-10 with TALLY_ZEBRANO ─────────────────
   * Feedback 3: "regarde pour le rtally detail (la matrice) si possible d'utiliser ce
   * format?". The grid is what answers it, and this is the same reachability question
   * the width table needed on 2026-09-08: built is not the same as visible.
   *
   * Before TALLY_ZEBRANO entered the rotation this was 0 of 67, because every document
   * we held had one length per bundle and `toLengthWidthGrid` correctly returns null
   * for those.
   *
   * 🔴 IT IS 32 OF 67, NOT 67 OF 67, AND THAT IS HONEST RATHER THAN BROKEN. 44 of the
   * 67 lots hash to the Zebrano document, but 12 of those land on one of its
   * single-length bundles (5, 6, 7, 8, 10...), which genuinely have one length and so
   * correctly draw the 1-D width table instead. Raising the number would mean biasing
   * DEMO_PICKS toward multi-length bundles the way it is already biased toward
   * multi-width ones - a deliberate choice about what the client sees, recorded as an
   * open question for Andrei rather than made here. What must NOT regress is that the
   * count is greater than zero and every lot still draws SOMETHING. */
  const grids = seen.filter((s) => toLengthWidthGrid(s.p.bundle));
  ok('the two-axis grid is reachable at all, which it was not before 2026-09-10',
    grids.length > 0, grids.length);
  ok('  ...on 32 of the 67 real lots, the rest correctly drawing the 1-D table',
    grids.length === 32, { grids: grids.length, of: seen.length });

  /* A grid must never be drawn for a bundle that is really one length. That is the bug
   * the adversarial review found on 2026-09-10: the gate counted raw matrix rows, so a
   * bundle reporting one length on two lines got a spurious 1-row grid. */
  const oneRowGrids = grids.filter((s) => toLengthWidthGrid(s.p.bundle).rows.length < 2)
    .map((s) => s.lot);
  ok('no lot draws a single-row grid, which would mean the old table was skipped wrongly',
    oneRowGrids.length === 0, oneRowGrids);

  /* Every grid cell must be a width the document itself declared. The same review found
   * the grid promoting an undeclared key to its own column, which would show a stray
   * parser artefact as a real measurement. */
  const strayCols = [];
  for (const s of grids) {
    const declared = s.p.bundle.matrix?.widthsIn || [];
    for (const w of toLengthWidthGrid(s.p.bundle).widths) {
      if (!declared.includes(w)) strayCols.push([s.lot, w]);
    }
  }
  ok('every grid column is a width the document declared', strayCols.length === 0,
    strayCols.slice(0, 6));

  if (!had) delete g.window;
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
