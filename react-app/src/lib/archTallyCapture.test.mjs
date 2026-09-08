/**
 * The adapter is tested against the REAL shipped parser, not a hand-made stub.
 *
 * MSL_LIB_PLSchema.js is `define([], () => ...)` with no dependencies, so a four-line
 * AMD shim loads the production module in node. Documents are built with its own
 * newDocument/newHeader/newBundle and passed through its own toLotReport, so what
 * reaches fromCaptureResult() is byte-for-byte what the custom record will hold.
 *
 * Run: npx tsx src/lib/archTallyCapture.test.mjs
 */
import fs from 'fs';
import path from 'path';
import { fromCaptureResult, bundlesForLot, fromCaptureRecord, CAPTURE_STATUS } from './archTallyCapture.ts';
import { toLengthDistribution, widthLabel, toWidthDistribution, checkPayload } from './archTally.ts';
import { TALLY_DETAIL_PL } from './archTallyDetailPL.ts';

const SCHEMA = path.join(
  'D:', 'HouseBlend', 'Clients', 'MGSL', 'Tasks', 'Task 11 - PO Allocation', 'docs',
  'Implementation data', 'Prod-all-custom-scripts-2026-08-27', 'SuiteScripts',
  'mcgi_services', 'packing_list', 'MSL_LIB_PLSchema.js',
);

let S;
{
  const src = fs.readFileSync(SCHEMA, 'utf8');
  let captured = null;
  const define = (deps, factory) => { captured = factory(); };
  // eslint-disable-next-line no-new-func
  new Function('define', src)(define);
  S = captured;
}

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};
ok('real parser module loaded', !!S && S.SCHEMA_VERSION === '1.0' && typeof S.toLotReport === 'function', S && S.SCHEMA_VERSION);

const dimMm = (raw, mm) => S.dimension(raw, mm, 'mm', mm, null, null, 1);
const dimFt = (raw, ft) => S.dimension(raw, ft, 'ft', null, null, ft, 1);
const leaf = (v) => ({ value: v, confidence: 1 });

/** Build a document the way the parser's own pipeline does. */
const doc = (bundles, headerPatch) => {
  const d = S.newDocument({ fileName: 'PL TEST.pdf', parsedAt: '2026-08-31T00:00:00Z' });
  d.header = Object.assign(S.newHeader(), headerPatch || {});
  const item = S.newItem();
  item.itemKey = 'TEST';
  item.species = 'IPE';
  item.bundles = bundles;
  d.items = [item];
  return d;
};

// ---------------------------------------------------------------- item 3: container
{
  const b = S.newBundle();
  b.bundleNo = leaf('1535');
  b.pieces = leaf(140);
  b.thickness = dimMm('19.05mm', 19.05);
  b.width = dimMm('139.7mm', 139.7);
  b.length = dimFt("8'", 8);
  b.volumeM3 = leaf(0.918);
  const res = S.toLotReport(doc([b], {
    poCandidates: [leaf('314307')],
    containerNumbers: [leaf('MEDU7574050')],
    supplierName: leaf('MADEIRAS NORTE'),
  }));
  ok('ITEM 3 parser emits references.container', res.references.container === 'MEDU7574050', res.references);

  const out = fromCaptureResult(res);
  ok('ITEM 3 adapter surfaces container in the header', out.header.container === 'MEDU7574050', out && out.header);
  ok('ITEM 3 adapter surfaces the PO too', out.header.po === '314307', out.header);
  ok('ITEM 3 supplier and file carried', out.header.supplier === 'MADEIRAS NORTE' && /PL TEST\.pdf/.test(out.header.sourceFile), out.header);

  // ---- item 4: the bundle itself
  const bundle = out.payload.bundles[0];
  ok('ITEM 4 bundleNo from the document', bundle.bundleNo === '1535', bundle.bundleNo);
  ok('ITEM 4 thickness 19.05mm -> 0.75in', bundle.thickness.inches === 0.75, bundle.thickness);
  ok('ITEM 4 width 139.7mm -> 5.5in', bundle.width.inches === 5.5, bundle.width);
  ok('ITEM 4 widthPolicy printed', bundle.widthPolicy === 'printed', bundle.widthPolicy);
  ok('ITEM 4 widthLabel shows 5.5in not RW', widthLabel(bundle) === '5.5"', widthLabel(bundle));
  ok('ITEM 4 length 8ft', bundle.lengthFt === 8, bundle.lengthFt);
  ok('ITEM 4 totals carried', bundle.totals.pieces === 140 && bundle.totals.volumeM3 === 0.918, bundle.totals);

  const dist = toLengthDistribution(out.payload.bundles);
  ok('ITEM 4 renders as one 8ft row of 140', dist.rows.length === 1 && dist.rows[0].label === "8'" && dist.rows[0].pieces === 140, dist.rows);
}

// ---------------------------------------------------------------- RW must come from the document
{
  const b = S.newBundle();
  b.bundleNo = leaf('92');
  b.pieces = leaf(63);
  b.thickness = dimMm('31.75mm', 31.75);
  b.width = null;                       // supplier printed no width
  b.length = dimFt("10'", 10);
  b.boardFeet = leaf(899);
  const res = S.toLotReport(doc([b], { containerNumbers: [] }));
  const rwKey = res.lots[0].matrix.widths.indexOf('RW') >= 0;
  ok('parser marks a width-less column RW', rwKey, res.lots[0].matrix.widths);

  const out = fromCaptureResult(res);
  const bundle = out.payload.bundles[0];
  ok('RW propagates to widthPolicy', bundle.widthPolicy === 'randomWidth', bundle.widthPolicy);
  ok('RW yields no numeric width', bundle.width === null && bundle.matrix.widthsIn.length === 0, bundle);
  ok('RW renders as RW', widthLabel(bundle) === 'RW', widthLabel(bundle));
  ok('no container -> null, not a guess', out.header.container === null, out.header);
  const dist = toLengthDistribution(out.payload.bundles);
  ok('declared BF survives', dist.rows[0].boardFeet === 899, dist.rows[0]);
}

// ---------------------------------------------------------------- axis=length
{
  const b = S.newBundle();
  b.bundleNo = leaf('L1');
  b.thickness = dimMm('25.4mm', 25.4);
  b.width = dimMm('139.7mm', 139.7);
  b.lengthBreakdown = [
    { length: dimFt("8'", 8), pieces: 60 },
    { length: dimFt("12'", 12), pieces: 40 },
  ];
  b.pieces = leaf(100);
  const res = S.toLotReport(doc([b]));
  ok('parser axis=length', res.lots[0].matrix.axis === 'length', res.lots[0].matrix.axis);
  const out = fromCaptureResult(res);
  const dist = toLengthDistribution(out.payload.bundles);
  ok('multi-length bundle splits 60/40', dist.rows.length === 2 && dist.rows[0].pieces === 60 && dist.rows[1].pieces === 40, dist.rows);
  ok('multi-row volume not attributed to one length', dist.rows.every((r) => r.volumeM3 === null), dist.rows);
  ok('bundle counted once overall', dist.totals.bundles === 1, dist.totals);
}

// ---------------------------------------------------------------- axis=width
{
  const b = S.newBundle();
  b.bundleNo = leaf('W1');
  b.thickness = dimMm('25.4mm', 25.4);
  b.length = dimFt("10'", 10);
  b.widthBreakdown = [
    { width: dimMm('152.4mm', 152.4), pieces: 30 },
    { width: dimMm('228.6mm', 228.6), pieces: 20 },
  ];
  b.pieces = leaf(50);
  const res = S.toLotReport(doc([b]));
  ok('parser axis=width', res.lots[0].matrix.axis === 'width', res.lots[0].matrix.axis);
  const out = fromCaptureResult(res);
  const bundle = out.payload.bundles[0];
  ok('two width columns carried', bundle.matrix.widthsIn.length === 2, bundle.matrix.widthsIn);
  const dist = toLengthDistribution(out.payload.bundles);
  ok('width breakdown collapses to one 10ft row of 50', dist.rows.length === 1 && dist.rows[0].pieces === 50, dist.rows);
}

// ---------------------------------------------------------------- the structural claim
{
  const b = S.newBundle();
  b.bundleNo = leaf('X');
  b.pieces = leaf(10);
  b.widthBreakdown = [{ width: dimMm('152.4mm', 152.4), pieces: 10 }];
  b.lengthBreakdown = [{ length: dimFt("8'", 8), pieces: 10 }];
  const res = S.toLotReport(doc([b]));
  ok('parser CANNOT emit a 2-D grid: width wins, length ignored',
    res.lots[0].matrix.axis === 'width' && res.lots[0].matrix.rows.length === 1, res.lots[0].matrix);
}

// ---------------------------------------------------------------- lot matching
{
  const mk = (no) => { const b = S.newBundle(); b.bundleNo = leaf(no); b.pieces = leaf(1); b.length = dimFt("8'", 8); return b; };
  const res = S.toLotReport(doc([mk('316027-1'), mk('316027-2')]));
  const out = fromCaptureResult(res);
  ok('exact lot match finds its bundle', bundlesForLot(out.payload, '316027-2').length === 1, null);
  ok('case and space tolerated', bundlesForLot(out.payload, ' 316027-2 ').length === 1, null);
  ok('a near miss matches NOTHING', bundlesForLot(out.payload, '316027').length === 0, null);
  ok('unknown lot matches nothing', bundlesForLot(out.payload, '999-9').length === 0, null);
}

// ---------------------------------------------------------------- garbage in
ok('null returns null', fromCaptureResult(null) === null, null);
ok('empty string returns null', fromCaptureResult('') === null, null);
ok('malformed JSON returns null, does not throw', fromCaptureResult('{oops') === null, null);
ok('JSON string is parsed', !!fromCaptureResult(JSON.stringify({ lots: [{ lot: 'a', pieces: 1 }] })), null);
ok('no lots returns null', fromCaptureResult({ lots: [] }) === null, null);
ok('lots not an array returns null', fromCaptureResult({ lots: 'x' }) === null, null);
ok('a lot with nothing in it still yields a bundle',
  fromCaptureResult({ lots: [{}] }).payload.bundles.length === 1, null);
ok('nameless lot does not pretend to have a number',
  fromCaptureResult({ lots: [{}] }).payload.bundles[0].lot === null, null);


// ═══════════════════════════════════════════════════════════════════════════
// fromCaptureRecord — one field, two writers, two shapes
// ═══════════════════════════════════════════════════════════════════════════

const TALLY_V1 = {
  schema: 'mgsl.tally.v1',
  po: 'PO-314888',
  container: 'BMOU6888755',
  bundles: [{
    bundleNo: 'S8-0142', lot: 'LOT-2026-0871', species: 'Red Oak',
    thickness: { raw: '4/4', inches: 1.0 },
    matrix: { widthsIn: [6, 9], rows: [{ lengthFt: 8, pieces: { '6': 30, '9': 20 } }] },
    totals: { pieces: 50, boardFeet: 240.0, volumeM3: null },
  }],
  provenance: { sourceFile: 'PL IPE PO 314888.pdf', skill: 'mgsl-tally-parse@0.1' },
};

const intake = (o) => JSON.stringify(o);

// ---- shape sniffing
{
  const r = fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY', filename: 'x.pdf' }), resultsJson: JSON.stringify(TALLY_V1), status: 'PARSED' });
  ok('skill payload detected as mgsl.tally.v1', r.shape === 'mgsl.tally.v1', r.shape);
  ok('bundles come through untouched', r.payload.bundles.length === 1 && r.payload.bundles[0].bundleNo === 'S8-0142', r.payload && r.payload.bundles);
  ok('container read from the payload', r.header.container === 'BMOU6888755', r.header);
  ok('PO read from the payload', r.header.po === 'PO-314888', r.header);
  ok('a real width x length GRID survives the v1 path', r.payload.bundles[0].matrix.widthsIn.length === 2, r.payload.bundles[0].matrix);
}
{
  const lotReport = { sourceFile: 'x.pdf', references: { po: '314307', container: 'MEDU7574050' },
    lots: [{ lot: '1535', pieces: 140, thicknessMm: 19.05, widthMm: 139.7, lengthMm: 2438.4 }] };
  const r = fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(lotReport), status: 'PARSED' });
  ok('MR payload detected as lotReport', r.shape === 'lotReport', r.shape);
  ok('lotReport container still surfaces', r.header.container === 'MEDU7574050', r.header);
  ok('lotReport bundles converted', r.payload.bundles.length === 1, r.payload && r.payload.bundles.length);
  // REGRESSION 2026-09-04. fromCaptureResult set header.container and then built the
  // payload without it, so every lot-report capture lost the container on the half
  // that actually gets rendered. Asserting the header alone is what let it survive:
  // assert BOTH, always.
  ok('lotReport container reaches the PAYLOAD, not just the header',
    r.payload.container === 'MEDU7574050', r.payload && r.payload.container);
}

// ---- docType discriminates; PL and BOL share this record
{
  const pl = fromCaptureRecord({ intakeJson: intake({ docType: 'PL' }), resultsJson: JSON.stringify(TALLY_V1), status: 'PARSED' });
  ok('a PL capture is not a tally', pl.isTally === false, pl.isTally);
  const bol = fromCaptureRecord({ intakeJson: intake({ docType: 'BOL' }), resultsJson: JSON.stringify(TALLY_V1), status: 'PARSED' });
  ok('a BOL capture is not a tally', bol.isTally === false, bol.isTally);
  const none = fromCaptureRecord({ resultsJson: JSON.stringify(TALLY_V1), status: 'PARSED' });
  ok('no intake envelope is NOT assumed to be a tally', none.isTally === false, none.isTally);
  const t = fromCaptureRecord({ intakeJson: intake({ docType: 'tally' }), resultsJson: JSON.stringify(TALLY_V1), status: 'PARSED' });
  ok('docType match is case-insensitive', t.isTally === true, t.isTally);
}

// ---- status by NAME, never by id
{
  const shown = (st) => fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(TALLY_V1), status: st }).displayable;
  ok('PARSED is displayable', shown(CAPTURE_STATUS.PARSED) === true, null);
  ok('MATCHED is displayable', shown(CAPTURE_STATUS.MATCHED) === true, null);
  ok('REVIEWED is displayable', shown('REVIEWED') === true, null);
  ok('PENDING is NOT displayable', shown(CAPTURE_STATUS.PENDING) === false, null);
  ok('NEEDS_REVIEW is NOT displayable', shown(CAPTURE_STATUS.NEEDS_REVIEW) === false, null);
  ok('ERROR is NOT displayable', shown(CAPTURE_STATUS.ERROR) === false, null);
  ok('AWAITING_CLAUDE is NOT displayable', shown(CAPTURE_STATUS.AWAITING_CLAUDE) === false, null);
  ok('status matching is case-insensitive', shown('parsed') === true, null);
  ok('a numeric id is NOT accepted as a status', shown('4') === false, null);
  const nr = fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(TALLY_V1), status: 'NEEDS_REVIEW', statusReason: 'PDF only — matrix not parsed' });
  ok('status reason is carried', nr.statusReason === 'PDF only — matrix not parsed', nr.statusReason);
  ok('NEEDS_REVIEW sets needsReview on the header', nr.header.needsReview === true, nr.header);
}

// ---- garbage in, no matrix out
{
  ok('null record does not throw', fromCaptureRecord(null).shape === 'absent', null);
  ok('undefined record does not throw', fromCaptureRecord(undefined).shape === 'absent', null);
  ok('empty results is absent', fromCaptureRecord({ resultsJson: '' }).shape === 'absent', null);
  ok('malformed JSON is absent, not a throw', fromCaptureRecord({ resultsJson: '{oops' }).shape === 'absent', null);
  ok('a JSON scalar is absent', fromCaptureRecord({ resultsJson: '42' }).shape === 'absent', null);
  const un = fromCaptureRecord({ resultsJson: JSON.stringify({ something: 'else' }) });
  ok('an unknown shape is refused, not rendered', un.shape === 'unrecognised' && un.payload === null, un.shape);
  const badSchema = fromCaptureRecord({ resultsJson: JSON.stringify({ schema: 'mgsl.tally.v9', bundles: [] }) });
  ok('a future schema version is NOT read as v1', badSchema.shape === 'unrecognised', badSchema.shape);
  const noBundles = fromCaptureRecord({ resultsJson: JSON.stringify({ schema: 'mgsl.tally.v1' }) });
  ok('v1 without a bundles array is refused', noBundles.shape === 'unrecognised', noBundles.shape);
}


// ---- grade and widthUnit must survive the lotReport path.
// Both were declared on TallyBundle before anything populated them: grade was added
// BECAUSE the adapter dropped it, and then the adapter still dropped it. Fixed
// 2026-09-05; these pin it.
{
  const lotReport = {
    sourceFile: 'g.pdf',
    references: { po: '314307', container: 'MEDU7574050' },
    lots: [{
      lot: '1535', pieces: 50, grade: 'FIRST AND SECOND',
      thicknessMm: 25, widthMm: 139.7, lengthMm: 2438.4,
      matrix: { axis: 'width', widths: [5.5, 6], rows: [{ len: 8, counts: { '5.5': 30, '6': 20 }, pcs: 50 }] },
    }],
  };
  const r = fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(lotReport), status: 'PARSED' });
  const b = r.payload.bundles[0];
  ok('grade survives the adapter', b.grade === 'FIRST AND SECOND', b.grade);
  ok('matrix declares its unit rather than relying on the default',
    b.matrix.widthUnit === 'in', b.matrix && b.matrix.widthUnit);
  // The parser converts to inches via widthIn() (d.mm / 25.4), so 'in' is the truth
  // here, not an assumption. If a future parser emits mm this assertion is the tripwire.
  ok('width keys are the parser\'s inches, carried through', b.matrix.widthsIn.join(',') === '5.5,6',
    b.matrix.widthsIn);
  ok('a lot with no grade yields null, not undefined',
    fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }),
      resultsJson: JSON.stringify({ lots: [{ lot: 'x', pieces: 1 }] }), status: 'PARSED' })
      .payload.bundles[0].grade === null, null);
}

// ---- the check reaches the caller. Added 2026-09-05.
// fromCaptureRecord has FOUR returns; the check is applied at one wrapper exit so a
// fifth shape cannot silently ship unchecked. These assertions are what enforce that.
{
  const rec = (r, st) => ({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(r), status: st || 'PARSED' });

  ok('a clean v1 payload reports ok', fromCaptureRecord(rec(TALLY_V1)).check.ok, fromCaptureRecord(rec(TALLY_V1)).check);

  // the same payload, one column removed, so 30 + 10 no longer makes the stated 50
  const bad = JSON.parse(JSON.stringify(TALLY_V1));
  bad.bundles[0].matrix.rows[0].pieces['9'] = 10;
  const rb = fromCaptureRecord(rec(bad));
  ok('a v1 payload that does not foot is FLAGGED, not rejected', rb.check.ok === false && rb.payload !== null, rb.check);
  ok('  ...and the issue names the bundle a view must not total',
    rb.check.issues[0].bundleNo === 'S8-0142' && rb.check.issues[0].index === 0, rb.check.issues);

  // the converted lotReport path must be checked too, not just the pass-through cast
  const badLot = { sourceFile: 'x.pdf', references: { po: '1' },
    lots: [{ lot: 'L1', pieces: 99, matrix: { axis: 'width', widths: [6], rows: [{ len: 2438.4, counts: { '6': 3 } }] } }] };
  const rl = fromCaptureRecord(rec(badLot));
  ok('the converted lotReport path is checked as well', rl.shape === 'lotReport' && rl.check.ok === false, rl.check);

  // every non-payload exit still carries a check, so no caller needs a guard
  ok('an absent payload still carries a check', fromCaptureRecord(rec(null)).check.ok === true, null);
  ok('an unrecognised payload still carries a check', fromCaptureRecord(rec({ nope: 1 })).check.ok === true, null);
  ok('a null record still carries a check', fromCaptureRecord(null).check.ok === true, null);
}

// ---- PER-LOT needsReview. The parser flags the individual lot it doubts; until
// 2026-09-05 only the DOCUMENT-level flag reached the header, so a document whose 7th
// bundle could not be read cleanly rendered exactly like a clean one.
{
  const doc = { sourceFile: 'x.pdf', references: { po: '1' }, lots: [
    { lot: 'A', pieces: 10 },
    { lot: 'B', pieces: 10, needsReview: true },
  ] };
  const r = fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(doc), status: 'PARSED' });
  ok('one flagged lot marks the document for review', r.header.needsReview === true, r.header);
  ok('  ...and the warning NAMES it, because "needs review" alone is not actionable',
    r.header.warnings.some((w) => w.includes('B')), r.header.warnings);
  ok('  ...naming the lot, not the unflagged one', r.header.warnings.every((w) => !w.includes('A')), r.header.warnings);

  const clean = { sourceFile: 'x.pdf', references: { po: '1' }, lots: [{ lot: 'A', pieces: 10 }] };
  const rc = fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(clean), status: 'PARSED' });
  ok('no flagged lot leaves the document clean', rc.header.needsReview === false && rc.header.warnings.length === 0, rc.header);

  // a lot with no number still has to be findable
  const anon = { sourceFile: 'x.pdf', references: { po: '1' }, lots: [{ pieces: 10, needsReview: true }] };
  const ra = fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(anon), status: 'PARSED' });
  ok('a flagged lot with no number is named by position', ra.header.warnings.some((w) => w.includes('#1')), ra.header.warnings);

  // document-level warnings must survive, not be replaced
  const both = { sourceFile: 'x.pdf', references: { po: '1' }, warnings: ['page 2 was skewed'],
    lots: [{ lot: 'C', pieces: 10, needsReview: true }] };
  const rboth = fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }), resultsJson: JSON.stringify(both), status: 'PARSED' });
  ok('the parser own document warnings are kept alongside the new one', rboth.header.warnings.length === 2, rboth.header.warnings);
}

// ---- DEFECT REGRESSIONS, found 2026-09-07 by an adversarial coverage sweep.
// All four were latent because nothing calls the read path yet; all become live the
// moment the ARCH cache MR starts serving tallies.
{
  // 1a. The flagged-lot warning named the WRONG bundle. The map ran over the FILTERED
  // array, so the index was the position among flagged lots, not in res.lots. With one
  // flagged lot it read correctly by coincidence, which is why the original test passed.
  const doc = (n, flagAt) => ({ sourceFile: 'x', references: { po: '1' },
    lots: Array.from({ length: n }, (_, i) => ({
      lot: flagAt.includes(i + 1) ? null : 'L' + (i + 1), pieces: 10,
      needsReview: flagAt.includes(i + 1),
    })) });
  const w = (n, flagAt) => fromCaptureRecord({ intakeJson: intake({ docType: 'TALLY' }),
    resultsJson: JSON.stringify(doc(n, flagAt)), status: 'PARSED' }).header.warnings;

  ok('an anonymous flagged lot is named by its position in the DOCUMENT, not among the flagged',
    w(7, [7])[0].includes('#7'), w(7, [7]));
  ok('  ...and not by its rank in the filtered list', !w(7, [7])[0].includes('#1'), w(7, [7]));
  ok('two anonymous flagged lots get their own document positions',
    w(7, [3, 6])[0].includes('#3') && w(7, [3, 6])[0].includes('#6'), w(7, [3, 6]));
  ok('a single flagged lot at position 1 still reads #1', w(3, [1])[0].includes('#1'), w(3, [1]));

  // 1b. bundlesForLot returned the WHOLE DOCUMENT for a whitespace lot number: '   '
  // is truthy, trims to '', and '' equals String(b.lot ?? '') for every null-lot bundle.
  // This is the wrong-shipment join the function's own comment forbids.
  ok('a whitespace lot number matches NOTHING, not every null-lot bundle',
    bundlesForLot(TALLY_DETAIL_PL, '   ').length === 0, bundlesForLot(TALLY_DETAIL_PL, '   ').length);
  ok('a tab likewise', bundlesForLot(TALLY_DETAIL_PL, '\t').length === 0, null);
  ok('an empty string likewise', bundlesForLot(TALLY_DETAIL_PL, '').length === 0, null);
  ok('a real lot number still finds its bundle', (() => {
    const p = { schema: 'mgsl.tally.v1', po: null, container: null,
      bundles: [{ bundleNo: 'a', lot: 'X1', matrix: null, totals: { pieces: 1, boardFeet: null, volumeM3: null } },
                { bundleNo: 'b', lot: null, matrix: null, totals: { pieces: 1, boardFeet: null, volumeM3: null } }] };
    return bundlesForLot(p, 'X1').length === 1 && bundlesForLot(p, '  ').length === 0;
  })(), null);

  // 1d. A zero-width column was dropped from widthsIn, then toRows folded its pieces
  // into the '' bucket, so the pieces became "unstated" with nothing saying so.
  {
    const res = { sourceFile: 'x', references: { po: '1' }, lots: [{ lot: 'Z', pieces: 5,
      matrix: { axis: 'width', widths: [0, 6], rows: [{ len: null, counts: { '0': 2, '6': 3 } }] } }] };
    const b = fromCaptureResult(res).payload.bundles[0];
    const d = toWidthDistribution(b);
    ok('a zero-width column does not silently swallow its pieces',
      d.totals.attributed + d.unattributed === 5, d);
    ok('  ...and the bundle is NOT degenerate while pieces sit unattributed, so the table renders',
      d.degenerate === false, d);
  }
}

// ---- THE TWO ROUNDING CONTRACTS, pinned 2026-09-08.
// Every width in this suite was an exact quarter inch, so mmToIn's 2dp fallback and the
// parser's 3dp r3 returned identical values and the divergence was invisible. Measured:
// 19 of 27 realistic widths disagreed. These use NON-quarter widths on purpose.
{
  const rw = (widthMm, cols) => {
    const b = S.newBundle();
    b.bundleNo = leaf('R1');
    b.thickness = dimMm('25mm', 25);
    b.width = dimMm(widthMm + 'mm', widthMm);
    b.length = dimFt("8'", 8);
    b.widthBreakdown = cols.map((c) => ({ width: dimMm(c[0] + 'mm', c[0]), pieces: c[1] }));
    b.pieces = leaf(cols.reduce((a, c) => a + c[1], 0));
    return b;
  };
  // 133mm is 5.23622...", 100mm is 3.937". Neither is a quarter.
  const b = fromCaptureResult(S.toLotReport(doc([rw(133, [[133, 6], [100, 4]])]))).payload.bundles[0];

  ok('the scalar width uses the SAME 3dp contract as the matrix',
    b.width.inches === 5.236, b.width && b.width.inches);
  ok('  ...and the matrix keys agree with it', b.matrix.widthsIn.indexOf(5.236) >= 0, b.matrix.widthsIn);
  ok('  ...so widthLabel cannot print a number the table contradicts',
    String(widthLabel(b)).indexOf('5.236') >= 0, widthLabel(b));
  ok('a second non-quarter width also matches the parser',
    b.matrix.widthsIn.indexOf(3.937) >= 0, b.matrix.widthsIn);
  ok('thickness follows the same contract: 25mm is 0.984, not 0.98',
    b.thickness.inches === 0.984, b.thickness);
  ok('an EXACT quarter still snaps, because 139.7mm really is 5.5"',
    fromCaptureResult(S.toLotReport(doc([rw(139.7, [[139.7, 10]])]))).payload.bundles[0].width.inches === 5.5, null);
  ok('25.4mm is exactly one inch',
    fromCaptureResult(S.toLotReport(doc([rw(25.4, [[25.4, 10]])]))).payload.bundles[0].width.inches === 1, null);
  ok('two non-quarter widths stay TWO in the matrix, as sameItem now sees them',
    b.matrix.widthsIn.length === 2, b.matrix.widthsIn);
}

// ---- THE RANDOM-WIDTH KEY, pinned 2026-09-08. '' is what our adapter emits, 'RW' is
// what the shipped parser and the document use, and the skill that writes v1 payloads is
// Lucas's. Before this an 'RW'-keyed payload was reported as a parser fault.
{
  const RB = (pieces, stated) => ({ schema: 'mgsl.tally.v1', po: null, container: null,
    bundles: [{ bundleNo: 'RW1', lot: null, species: null,
      thickness: { raw: null, inches: 1 }, width: null, widthPolicy: 'RW', lengthFt: 8,
      matrix: { widthsIn: [6], rows: [{ lengthFt: 8, pieces }] },
      totals: { pieces: stated, boardFeet: null, volumeM3: null },
      provenance: { page: null, confidence: null } }] });

  ok("an 'RW' key is NOT a stray width", checkPayload(RB({ '6': 4, 'RW': 6 }, 10)).ok,
    checkPayload(RB({ '6': 4, 'RW': 6 }, 10)).issues);
  ok("  ...nor lower-case 'rw'", checkPayload(RB({ '6': 4, 'rw': 6 }, 10)).ok, null);
  ok("  ...nor ' RW ' with spaces", checkPayload(RB({ '6': 4, ' RW ': 6 }, 10)).ok, null);
  ok('an empty key is still accepted', checkPayload(RB({ '6': 4, '': 6 }, 10)).ok, null);
  ok('a genuine stray width is STILL flagged, so this did not just disable the check',
    checkPayload(RB({ '6': 4, '7': 6 }, 10)).issues.some((i) => i.kind === 'strayWidth'),
    checkPayload(RB({ '6': 4, '7': 6 }, 10)).issues);
  ok("'RW' pieces are counted, not dropped", (() => {
    const d = toWidthDistribution(RB({ '6': 4, 'RW': 6 }, 10).bundles[0]);
    return d.totals.attributed + d.unattributed === 10 && d.unattributed === 6;
  })(), null);
  ok('  ...and the table renders rather than hiding them',
    toWidthDistribution(RB({ '6': 4, 'RW': 6 }, 10).bundles[0]).degenerate === false, null);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
