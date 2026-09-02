import { toLengthDistribution, widthLabel, widthNote, sameItem, siblingsOf } from './archTally.ts';
import { TALLY_314307, TALLY_CHECHEN, demoTallyForLot } from './archTallyFixtures.ts';

const B = (o) => ({ bundleNo: 'x', lot: null, species: null, thickness: { raw: null, inches: 1 },
  matrix: null, totals: { pieces: null, boardFeet: null, volumeM3: null }, ...o });
let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// ---- S3: multi-row bundle must split across lengths, not dump into rows[0]
{
  const d = toLengthDistribution([B({ bundleNo: 'm', totals: { pieces: 100, boardFeet: null, volumeM3: 5 },
    matrix: { widthsIn: [], rows: [{ lengthFt: 8, pieces: { '': 60 } }, { lengthFt: 12, pieces: { '': 40 } }] } })]);
  ok('S3 multi-row splits 60/40 across 8 and 12', d.rows.length === 2 && d.rows[0].pieces === 60 && d.rows[1].pieces === 40, d.rows);
  ok('S3 multi-row volume not attributed to one length', d.rows.every((r) => r.volumeM3 === null), d.rows);
  ok('S3 multi-row counted once in totals', d.totals.bundles === 1 && d.totals.pieces === 100, d.totals);
}

// ---- S4: range rows keep their range, not "—"
{
  const d = toLengthDistribution([B({ bundleNo: 'r', totals: { pieces: 50, boardFeet: null, volumeM3: null },
    matrix: { widthsIn: [], rows: [{ lengthFtMin: 12, lengthFtMax: 14, pieces: { '': 50 }, declaredBF: 700 }] } })]);
  ok('S4 range renders as 12-14\'', d.rows[0].label === "12-14'", d.rows[0]);
  ok('S4 range uses declaredBF', d.rows[0].boardFeet === 700, d.rows[0]);
}

// ---- S4b: a range sorts by its start, between 10 and 16
{
  const d = toLengthDistribution([
    B({ bundleNo: 'a', lengthFt: 16, totals: { pieces: 1, boardFeet: null, volumeM3: null } }),
    B({ bundleNo: 'b', totals: { pieces: 1, boardFeet: null, volumeM3: null }, matrix: { widthsIn: [], rows: [{ lengthFtMin: 12, lengthFtMax: 14, pieces: { '': 1 } }] } }),
    B({ bundleNo: 'c', lengthFt: 10, totals: { pieces: 1, boardFeet: null, volumeM3: null } }),
  ]);
  ok('S4b sort order 10 / 12-14 / 16', d.rows.map((r) => r.label).join(',') === "10',12-14',16'", d.rows.map((r) => r.label));
}

// ---- S2: partial sums flagged, not shown as totals
{
  const d = toLengthDistribution([
    B({ bundleNo: 'p1', lengthFt: 8, totals: { pieces: 10, boardFeet: 100, volumeM3: 1 } }),
    B({ bundleNo: 'p2', lengthFt: 8, totals: { pieces: 10, boardFeet: null, volumeM3: 1 } }),
  ]);
  ok('S2 partial BF flagged', d.rows[0].boardFeet === 100 && d.rows[0].boardFeetPartial === true, d.rows[0]);
  ok('S2 complete m3 NOT flagged', d.rows[0].volumeM3 === 2 && d.rows[0].volumePartial === false, d.rows[0]);
  ok('S2 totals BF flagged too', d.totals.boardFeetPartial === true, d.totals);
}

// ---- S8: duplicate bundleNo at different lengths marks by identity
{
  const dup = [B({ bundleNo: '92', lengthFt: 4, totals: { pieces: 1, boardFeet: null, volumeM3: null } }),
               B({ bundleNo: '92', lengthFt: 9, totals: { pieces: 1, boardFeet: null, volumeM3: null } })];
  const d = toLengthDistribution(dup);
  const marked = d.rows.filter((r) => r.bundleIdx.includes(dup.indexOf(dup[0])));
  ok('S8 only the clicked bundle is marked', marked.length === 1 && marked[0].label === "4'", d.rows);
}

// ---- S6: RW is never inferred from a null width
{
  ok('S6 unknown width does not say RW', widthLabel(B({ width: null })) === '—', widthLabel(B({ width: null })));
  ok('S6 randomWidth says RW', widthLabel(B({ width: null, widthPolicy: 'randomWidth' })) === 'RW', null);
  ok('S6 printed width now returns no caveat', widthNote(B({width:{raw:null,inches:5.5}}))==='', widthNote(B({width:{raw:null,inches:5.5}})));
ok('S6 unknown note does not claim a supplier practice', !/random width/i.test(widthNote(B({ width: null }))), widthNote(B({ width: null })));
  ok('S6 RW note does claim it', /random width/i.test(widthNote(B({ width: null, widthPolicy: 'randomWidth' }))), null);
}

// ---- edges
ok('empty input', JSON.stringify(toLengthDistribution([]).rows) === '[]', null);
ok('null input does not throw', toLengthDistribution(null).rows.length === 0, null);
{
  const d = toLengthDistribution([B({ bundleNo: 'n1' }), B({ bundleNo: 'n2' })]);
  ok('two unknown lengths collapse to one row', d.rows.length === 1 && d.rows[0].label === '—', d.rows);
}

// ---- regression: the real documents still reproduce their own printed subtotals
{
  const d = toLengthDistribution(TALLY_314307.bundles);
  const printed = { "8'": 427, "10'": 420, "12'": 322, "14'": 373, "16'": 161, "18'": 161, "20'": 161 };
  const got = Object.fromEntries(d.rows.map((r) => [r.label, r.pieces]));
  ok('314307 per-length pieces match lengthPiecesTotals', JSON.stringify(got) === JSON.stringify(printed), got);
  ok('314307 totals match printed 2025 / 20.736', d.totals.pieces === 2025 && d.totals.volumeM3 === 20.736, d.totals);
  ok('314307 BF stays null (notPrinted)', d.totals.boardFeet === null && !d.totals.boardFeetPartial, d.totals);
}
{
  const th125 = TALLY_CHECHEN.bundles.filter((b) => b.thickness.inches === 1.25);
  const th1 = TALLY_CHECHEN.bundles.filter((b) => b.thickness.inches === 1);
  const a = toLengthDistribution(th125), b = toLengthDistribution(th1);
  ok('CHECHEN 1.25" section BF == printed 5072', a.totals.boardFeet === 5072, a.totals);
  ok('CHECHEN 1.0" section BF == 4284 (printed 4282, tol 2)', Math.abs(b.totals.boardFeet - 4282) <= 2, b.totals);
  ok('CHECHEN sections are complete, not partial', !a.totals.boardFeetPartial && !b.totals.boardFeetPartial, null);
  ok('CHECHEN whole doc pieces == printed 2139',
    toLengthDistribution(TALLY_CHECHEN.bundles).totals.pieces === 2139, null);
}

// ---- S1: the demo mapping must hand back sample provenance
{
  const d = demoTallyForLot('315643-5');
  ok('S1 demo returns sample provenance', !!(d && d.sample && d.sample.sourceFile), d && d.sample);
  ok('S1 sample names a real source file', /314307|CHECHEN|\.pdf|\.xlsx/i.test(d.sample.sourceFile), d.sample.sourceFile);
  ok('S1 demo bundle is in its own siblings', d.siblings.indexOf(d.bundle) >= 0, null);
}


// ---- MULTI-SPECIES CONTAMINATION. One packing list carries several species.
//      Reproduced 2026-09-02: selecting siblings by thickness alone rendered 350
//      pieces across 3 bundles for a Sapele lot whose real content is 50 pieces.
{
  const S = (species, th, len, pcs, w) => B({
    bundleNo: String(species) + len, species,
    thickness: { raw: th + 'in', inches: th }, width: w || null, lengthFt: len,
    totals: { pieces: pcs, boardFeet: null, volumeM3: null },
  });
  const doc = [
    S('African Mahogany', 1, 8, 100),
    S('African Mahogany', 1, 12, 200),
    S('Sapele', 1, 10, 50),
    S('African Mahogany', 2, 8, 75),
  ];
  const tot = (b) => toLengthDistribution(siblingsOf(doc, b)).totals;
  ok('Sapele shows only Sapele', tot(doc[2]).pieces === 50 && tot(doc[2]).bundles === 1, tot(doc[2]));
  ok('AM 4/4 shows only AM 4/4', tot(doc[0]).pieces === 300 && tot(doc[0]).bundles === 2, tot(doc[0]));
  ok('AM 8/4 separated from AM 4/4 by thickness', tot(doc[3]).pieces === 75, tot(doc[3]));
  ok('thickness alone WOULD have mixed three bundles',
    doc.filter((b) => b.thickness.inches === 1).length === 3, null);
  ok('width discriminates two otherwise identical items',
    !sameItem(S('X', 1, 8, 1, { raw: null, inches: 6 }), S('X', 1, 8, 1, { raw: null, inches: 9 })), null);
  ok('null width matches null width', sameItem(S('X', 1, 8, 1), S('X', 1, 12, 1)), null);
  ok('a null species does not join a named group',
    !sameItem(S(null, 1, 8, 1), S('Sapele', 1, 8, 1)), null);
  ok('species match ignores case and surrounding space',
    sameItem(S(' sapele ', 1, 8, 1), S('SAPELE', 1, 12, 1)), null);
  ok('siblingsOf always includes the bundle itself', siblingsOf([], doc[0]).length === 1, null);
  ok('siblingsOf tolerates a null list', siblingsOf(null, doc[0]).length === 1, null);
}


// ---- the reducer refuses to be the thing that silently sums a mixture
{
  const S = (species, th, len, pcs) => B({ bundleNo: String(species) + len, species,
    thickness: { raw: th + 'in', inches: th }, width: null, lengthFt: len,
    totals: { pieces: pcs, boardFeet: null, volumeM3: null } });
  const mixed = [S('African Mahogany', 1, 8, 100), S('Sapele', 1, 10, 50)];
  ok('mixed species flagged', toLengthDistribution(mixed).mixedItems === true, null);
  const mixedTh = [S('Sapele', 1, 8, 10), S('Sapele', 2, 8, 10)];
  ok('mixed thickness flagged', toLengthDistribution(mixedTh).mixedItems === true, null);
  const clean = [S('Sapele', 1, 8, 10), S('Sapele', 1, 12, 20)];
  ok('a homogeneous set is NOT flagged', toLengthDistribution(clean).mixedItems === false, null);
  ok('a single bundle is never flagged', toLengthDistribution([clean[0]]).mixedItems === false, null);
  ok('an empty set is not flagged', toLengthDistribution([]).mixedItems === false, null);
  ok('siblingsOf output is never flagged',
    toLengthDistribution(siblingsOf(mixed, mixed[1])).mixedItems === false, null);
}


// ---- the two guards are load-bearing TOGETHER, so test the seam between them.
//      mixedItems cannot catch a set of ONE wrong bundle; only the view's
//      selfIdx check can. Neither alone is sufficient.
{
  const S = (species, len, pcs) => B({
    bundleNo: String(species) + len, species,
    thickness: { raw: '1in', inches: 1 }, width: null, lengthFt: len,
    totals: { pieces: pcs, boardFeet: null, volumeM3: null },
  });
  const sapele = S('Sapele', 10, 50);
  const mahog = S('African Mahogany', 8, 100);

  const lone = toLengthDistribution([mahog]);
  ok('a single WRONG bundle is not flagged as mixed', lone.mixedItems === false, null);
  ok('  ...so only the view selfIdx guard can catch it', [mahog].indexOf(sapele) === -1, null);

  const doc = [mahog, sapele];
  ok('siblingsOf always contains the clicked bundle (Sapele)', siblingsOf(doc, sapele).indexOf(sapele) >= 0, null);
  ok('siblingsOf always contains the clicked bundle (Mahogany)', siblingsOf(doc, mahog).indexOf(mahog) >= 0, null);
  ok('siblingsOf on an unrelated set returns just the bundle',
    siblingsOf([mahog], sapele).length === 1 && siblingsOf([mahog], sapele)[0] === sapele, null);
  ok('  ...which is homogeneous, confirming selfIdx is the protection there',
    toLengthDistribution(siblingsOf([mahog], sapele)).mixedItems === false, null);
  ok('via siblingsOf the clicked bundle is always at a findable index',
    siblingsOf(doc, sapele).indexOf(sapele) >= 0 && siblingsOf(doc, mahog).indexOf(mahog) >= 0, null);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
