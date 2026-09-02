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
import { toLengthDistribution, widthLabel } from './archTally.ts';

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

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
