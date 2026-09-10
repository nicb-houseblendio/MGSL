/**
 * Generates src/lib/archTallyZebrano.ts from a real "pl inv" supplier xlsx.
 *
 * WHY THIS SCRIPT IS COMMITTED. Same reason as gen-detail-pl.py next to it:
 * archTallyFixtures.ts carries a header saying "DO NOT HAND-EDIT / Regenerate: node
 * scratchpad/genfix.mjs", and that generator does not exist anywhere - it lived in a
 * session scratchpad. So the file it guards is hand-maintained under a comment
 * forbidding hand-editing. This script exists so that does not happen a third time.
 *
 * SOURCE (not committed - `docs/` is deliberately never in git, see CLAUDE.md):
 *   docs/CWP ARCH/Documentation/September/Feedback 2/pl inv 01368.xlsx
 *   docs/CWP ARCH/Documentation/September/Feedback 2/pl inv 05513.xlsx
 * Both arrived from Marc-Antoine on 2026-09-10 in the Feedback 2 batch of 17 documents.
 *
 * RUN (from react-app/):
 *   node scripts/gen-zebrano.mjs "../docs/CWP ARCH/Documentation/September/Feedback 2/pl inv 01368.xlsx" src/lib/archTallyZebrano.ts
 *
 * Uses the repo's own `xlsx` (SheetJS) dependency rather than hand-rolled XML, unlike
 * gen-detail-pl.py, which predates the need and used zipfile+ElementTree so it could
 * run with no dependencies at all. Either is fine; this one is shorter.
 *
 * ⚠️ WHY THIS DOCUMENT MATTERS, and it is not just another packing list. It is the
 * first real document we hold where ONE bundle number spans SEVERAL lengths, each with
 * its own width spread - a genuine two-axis bundle. Every document before it had one
 * length per bundle, which is why `toLengthWidthGrid()` in archTally.ts did not exist
 * until 2026-09-10 and why the client's Feedback 3 mockup asks for a grid.
 *
 * ⚠️ THE SHEET'S OWN TRAPS, both handled below:
 *   1. The width for each colNN column comes from ROW 2, never from the colNN label.
 *      Do not derive it arithmetically.
 *   2. `t_thick` and `t_len` are STRINGS with a unit suffix ('50.00mm', '2250.00mm').
 *      Feeding them to a numeric parse without stripping the suffix yields NaN.
 *
 * ⚠️ LENGTHS ARE ON A 50mm GRID (2250, 2300, 2350...). archTallyLength.ts's
 * METRIC_STEP_MM had to be widened from 100mm to 50mm for these to print as
 * millimetres instead of 7.382'. If that ever goes back to 100, this document's labels
 * regress and archTallyReach.test.mjs fails.
 *
 * RECONCILES BEFORE EMITTING, and refuses to write if it cannot:
 *   - each row's width cells must sum to that row's own printed `t_pcs`
 *   - each bundle's rows must sum to the bundle's own total
 * Volume is COPIED, never recomputed - same rule as gen-detail-pl.py.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const args = process.argv.slice(2);
const testOnly = args.includes('--test-only');
const [srcPath, outPath] = args.filter((a) => a !== '--test-only');
if (!srcPath || !outPath) {
  console.error('usage: node scripts/gen-zebrano.mjs [--test-only] <source.xlsx> <out.ts>');
  console.error('  --test-only  mark the emitted fixture as NOT for the demo rotation');
  process.exit(2);
}

const wb = XLSX.readFile(srcPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });

// Row 0 is the field-name header, row 1 carries the width for each colNN. TRAP 1.
const header = rows[0].map((v) => (v == null ? '' : String(v).trim()));
const unitRow = rows[1].map((v) => (v == null ? '' : String(v).trim()));

const idx = (name) => header.indexOf(name);
const COL = {
  cont: idx('t_cont'), lot: idx('t_lotno'), sc: idx('t_scno'), bdle: idx('t_bdleno'),
  spc: idx('t_spcdescr'), gd: idx('t_gddescr'), thick: idx('t_thick'), len: idx('t_len'),
  pcs: idx('t_pcs'), vol: idx('t_vol'),
};
for (const [k, v] of Object.entries(COL)) {
  if (v < 0) { console.error('missing expected column: t_' + k); process.exit(1); }
}

/** colNN index -> width in mm, read from ROW 2 only. */
const widthCols = [];
for (let i = 0; i < header.length; i++) {
  if (!/^col\d+$/.test(header[i])) continue;
  const u = unitRow[i];
  if (u && /^\d+MM$/i.test(u)) widthCols.push({ i, mm: Number(u.replace(/MM/i, '')) });
}
if (!widthCols.length) { console.error('no MM width columns found in row 2'); process.exit(1); }

const stripUnit = (s) => Number(String(s == null ? '' : s).replace(/[^0-9.]/g, ''));
const num = (v) => (v == null || v === '' ? null : Number(v));
const ft = (mm) => Math.round((mm / 304.8) * 1000) / 1000;
const inches = (mm) => {
  const raw = mm / 25.4;
  const q = Math.round(raw * 4) / 4;
  return Math.abs(raw - q) < 1e-6 ? q : Math.round(raw * 1000) / 1000;
};

const byBundle = new Map();
const failures = [];
let docContainer = null; let docContract = null;

for (let r = 2; r < rows.length; r++) {
  const row = rows[r];
  if (!row) continue;
  const bno = row[COL.bdle];
  if (bno == null || String(bno).trim() === '') continue;

  const key = String(bno).trim();
  if (docContainer == null && row[COL.cont]) docContainer = String(row[COL.cont]).trim();
  if (docContract == null && row[COL.sc]) docContract = String(row[COL.sc]).trim();

  const lenMm = stripUnit(row[COL.len]);      // TRAP 2
  const thickMm = stripUnit(row[COL.thick]);  // TRAP 2
  const statedPcs = num(row[COL.pcs]);
  const statedVol = num(row[COL.vol]);

  const pieces = {};
  let cellSum = 0;
  for (const { i, mm } of widthCols) {
    const n = num(row[i]);
    if (!n) continue;
    pieces[String(mm)] = (pieces[String(mm)] || 0) + n;
    cellSum += n;
  }

  if (statedPcs != null && cellSum !== statedPcs) {
    failures.push(`bundle ${key} @ ${lenMm}mm: cells sum to ${cellSum}, sheet states ${statedPcs}`);
  }

  let b = byBundle.get(key);
  if (!b) {
    b = {
      bundleNo: key,
      species: row[COL.spc] ? String(row[COL.spc]).trim() : null,
      grade: row[COL.gd] ? String(row[COL.gd]).trim() : null,
      thickRaw: row[COL.thick] ? String(row[COL.thick]).trim() : null,
      thickMm,
      rows: [],
      pieces: 0,
      volumeM3: 0,
      anyVolume: false,
    };
    byBundle.set(key, b);
  }
  b.rows.push({ lenMm, pieces, statedPcs });
  b.pieces += statedPcs || cellSum;
  if (statedVol != null) { b.volumeM3 += statedVol; b.anyVolume = true; }
}

if (failures.length) {
  console.error('refusing to emit: ' + failures.length + ' row(s) do not reconcile');
  for (const f of failures.slice(0, 12)) console.error('  ' + f);
  process.exit(1);
}

const bundles = [...byBundle.values()];
const totalPieces = bundles.reduce((a, b) => a + b.pieces, 0);
const multiLength = bundles.filter((b) => new Set(b.rows.map((r) => r.lenMm)).size > 1);

console.log('source            : ' + path.basename(srcPath));
console.log('bundles           : ' + bundles.length);
console.log('multi-LENGTH ones : ' + multiLength.length + '  (' +
  multiLength.map((b) => b.bundleNo + ':' + new Set(b.rows.map((r) => r.lenMm)).size).join(', ') + ')');
console.log('total pieces      : ' + totalPieces);
console.log('reconciliation    : ALL ' + bundles.reduce((a, b) => a + b.rows.length, 0) + ' row(s) PASS');

const q = (v) => (v == null ? 'null' : JSON.stringify(v));

/* Export symbol derived from the OUTPUT filename, not hardcoded, so two invocations
 * against two source documents cannot collide on `TALLY_ZEBRANO`. archTallyZebrano.ts
 * -> TALLY_ZEBRANO; archTallyZebrano05513.ts -> TALLY_ZEBRANO05513. */
const SYM = 'TALLY_' + path.basename(outPath)
  .replace(/\.ts$/, '')
  .replace(/^archTally/, '')
  .replace(/[^A-Za-z0-9]/g, '')
  .toUpperCase();

const bundleTs = (b) => {
  const widths = [...new Set(b.rows.flatMap((r) => Object.keys(r.pieces).map(Number)))].sort((x, y) => x - y);

  /* 🔴 `lengthFt` IS THE BUNDLE'S SINGLE LENGTH, OR NULL - never blanket null.
   * Caught 2026-09-10 by opening the dialog and looking: emitting null for every
   * bundle dropped the "This bundle is 7 at 2650mm" clause in TallyMatrixPanel's
   * heading (it is guarded on `lengthFt != null`) for the single-length bundles, which
   * DO have one length the document states. Only a genuinely multi-length bundle has
   * no single length to report. */
  const distinct = [...new Set(b.rows.map((r) => r.lenMm))];
  const singleLengthFt = distinct.length === 1 ? ft(distinct[0]) : null;
  const rowsTs = b.rows
    .slice()
    .sort((x, y) => x.lenMm - y.lenMm)
    .map((r) => {
      const cells = Object.keys(r.pieces)
        .map(Number).sort((x, y) => x - y)
        .map((w) => `'${w}': ${r.pieces[w]}`)
        .join(', ');
      return `        { lengthFt: ${ft(r.lenMm)}, pieces: { ${cells} } }, // ${r.lenMm}mm, t_pcs=${r.statedPcs}`;
    })
    .join('\n');
  return `  {
    bundleNo: ${q(b.bundleNo)},
    lot: null,
    species: ${q(b.species)},
    grade: ${q(b.grade)},
    thickness: { raw: ${q(b.thickRaw)}, inches: ${inches(b.thickMm)} },
    width: null,
    widthPolicy: 'printed',
    lengthFt: ${singleLengthFt === null ? 'null' : singleLengthFt},
    matrix: {
      widthUnit: 'mm',
      widthsIn: [${widths.join(', ')}],
      rows: [
${rowsTs}
      ],
    },
    totals: { pieces: ${b.pieces}, boardFeet: null, volumeM3: ${b.anyVolume ? Math.round(b.volumeM3 * 10000) / 10000 : 'null'} },
  },`;
};

const testOnlyBlock = testOnly ? ` *
 * 🔴 TEST-ONLY. DO NOT ADD THIS TO ALL_DEMO_DOCS.
 *
 * This document exists here to HARDEN THE CODE, not to decorate the screen. It is the
 * gnarliest tally we hold, which makes it the best stress case for the grid reducer and
 * the worst thing to put in front of a trader: every figure in it belongs to a shipment
 * that has nothing to do with whichever lot the demo would attach it to.
 *
 * The demo rotation already carries ONE such document (archTallyZebrano.ts), labelled
 * on screen as a sample, which is enough to answer the client's question about the
 * FORMAT. A second one would double the amount of not-his-data on his screen and answer
 * nothing he asked. Decided 2026-09-10; the reasoning is in the todo-list, question 9.
 *
 * Use it in tests. Assert against it freely. Do not import it into archTallyFixtures.ts.
` : '';

const out = `/**
 * ${path.basename(srcPath)} - a real supplier document with TWO-AXIS bundles.
${testOnlyBlock} *
 * GENERATED by scripts/gen-zebrano.mjs. Do not hand-edit; the generator is committed
 * next to this file precisely so it can be re-run (unlike archTallyFixtures.ts, whose
 * generator was lost with a scratchpad). The source xlsx lives under \`docs/\`, which is
 * never committed - see the generator's header for the path and the exact command.
 *
 * WHY IT MATTERS. Every document before this one had ONE length per bundle, so the
 * tally view could be two 1-D tables (lengths across bundles, widths within a bundle).
 * Here ${multiLength.length} of ${bundles.length} bundles span SEVERAL lengths, each with its own width spread:
 * ${multiLength.slice(0, 6).map((b) => b.bundleNo + ' has ' + new Set(b.rows.map((r) => r.lenMm)).size + ' lengths').join(', ')}${multiLength.length > 6 ? ', ...' : ''}.
 * That is the shape Marc-Antoine's Feedback 3 mockup draws as a grid, and it is what
 * \`toLengthWidthGrid()\` in archTally.ts renders.
 *
 * RECONCILED on emit, and the generator refuses to write if it cannot:
 *   pieces - every row's width cells sum to that row's own printed t_pcs, exactly
 *   totals - ${totalPieces} pieces across ${bundles.length} bundles
 *
 * ⚠️ LENGTHS ARE METRIC, on a 50mm grid (2250, 2300, 2350mm...). They print as
 * millimetres only because archTallyLength.ts's METRIC_STEP_MM is 50; at the old 100mm
 * step five of bundle 11's nine lengths rendered as 7.382' / 7.71' / 8.038' / 8.366' /
 * 8.694'. See that file's measured soundness table before touching the step.
 *
 * ⚠️ \`lot\` is null on every bundle. The per-bundle key here is the supplier's own
 * t_bdleno ('11', '12-A', '16-B'), which matches no NetSuite inventory number - the
 * open question recorded in the todo-list as "14 bundles sur une ligne de PO". Keying
 * on the document-level t_lotno instead would make bundlesForLot() return the whole
 * document for any lot.
 */

import type { TallyPayload } from '@/lib/archTally';

export const ${SYM}: TallyPayload = {
  schema: 'mgsl.tally.v1',
  po: null,
  container: ${q(docContainer)},
  bundles: [
${bundles.map(bundleTs).join('\n')}
  ],
  provenance: {
    sourceFile: ${q(path.basename(srcPath))},
    parsedAt: null,
    skill: 'gen-zebrano.mjs@1 (SheetJS read, reconciled)',
    reviewedBy: null,
  },
};

/** The document's own figures, for tests to assert against. */
export const ${SYM}_TOTALS = { bundles: ${bundles.length}, pieces: ${totalPieces}, multiLengthBundles: ${multiLength.length} } as const;
`;

fs.writeFileSync(outPath, out, 'utf8');
console.log('-> wrote ' + outPath);
