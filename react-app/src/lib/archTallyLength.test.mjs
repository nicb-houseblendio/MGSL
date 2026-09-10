/**
 * archTallyLength.ts - the metric-aware Length cell.
 *
 * The two bounds in the header of that file are what make the detection safe, so they
 * are pinned here in both directions: every real metric length must be recognised, and
 * no imperial length may be. If `lengthFt` is ever stored to fewer than 3 decimal
 * places the first group fails, which is the point.
 */
import { metricMmFromFeet, feetInchesLabel, lengthDisplayFt, lengthDisplayRow } from './archTallyLength.ts';
import { TALLY_DETAIL_PL } from './archTallyDetailPL.ts';
import { TALLY_314307, TALLY_CHECHEN } from './archTallyFixtures.ts';
import { toLengthDistribution } from './archTally.ts';

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

// ---- the eight lengths of the one metric document we hold, off the document itself
{
  // detail pl inv 2026_00031.xlsx states 2400-4500mm in 300mm steps. These are the
  // stored 3dp foot figures; the mm figure is what the paper says.
  const cases = [
    [7.874, 2400, "7'10\""],
    [8.858, 2700, "8'10\""],
    [9.843, 3000, "9'10\""],
    [10.827, 3300, "10'10\""],
    [11.811, 3600, "11'10\""],
    [12.795, 3900, "12'10\""],
    [13.78, 4200, "13'9\""],
    [14.764, 4500, "14'9\""],
  ];
  const badMm = cases.filter(([ft, mm]) => metricMmFromFeet(ft) !== mm);
  ok('every metric length is recovered to the millimetre the document printed', badMm.length === 0, badMm);

  const badGloss = cases.filter(([ft, , gloss]) => feetInchesLabel(ft) !== gloss);
  ok('each one glosses to feet and inches with no 12-inch carry', badGloss.length === 0, badGloss);

  const badText = cases.filter(([ft, mm]) => lengthDisplayFt(ft).text !== `${mm}mm`);
  ok('lengthDisplayFt prints the document figure, not the conversion', badText.length === 0, badText);
  ok('  ...and says it is metric', cases.every(([ft]) => lengthDisplayFt(ft).metric === true), null);
}

// ---- COMPLETE. Every round metric length a supplier could print must be recovered,
// not just the eight this one document happens to carry.
{
  const missed = [];
  for (let mm = 300; mm <= 12000; mm += 100) {
    const ft = Number((mm / 304.8).toFixed(3)); // exactly how a generator stores it
    if (metricMmFromFeet(ft) !== mm) missed.push([mm, ft, metricMmFromFeet(ft)]);
  }
  ok('all 118 metric lengths from 300mm to 12000mm round-trip', missed.length === 0, missed.slice(0, 8));

  // ── THE 50mm GRID, added 2026-09-10 with the step change ────────────────────
  // `pl inv 01368.xlsx` / `pl inv 05513.xlsx` (Zebrano, FAS) print lengths on a FIFTY-
  // millimetre grid. At the old 100mm step the odd ones did not round-trip and printed
  // as 7.382' / 7.71' / 8.038' / 8.366' / 8.694', which is exactly the unreadable
  // output this file exists to prevent and what archTallyReach.test.mjs forbids.
  const missed50 = [];
  for (let mm = 300; mm <= 12000; mm += 50) {
    const ft = Number((mm / 304.8).toFixed(3));
    if (metricMmFromFeet(ft) !== mm) missed50.push([mm, ft, metricMmFromFeet(ft)]);
  }
  ok('every 50mm-grid length from 300mm to 12000mm round-trips', missed50.length === 0, missed50.slice(0, 8));

  // The nine real lengths of Zebrano bundle 11, which is why the step moved.
  const zebrano = [2250, 2300, 2350, 2400, 2450, 2500, 2550, 2600, 2650];
  const zLeaked = zebrano.filter((mm) => {
    const ft = Number((mm / 304.8).toFixed(3));
    return lengthDisplayFt(ft).text !== `${mm}mm`;
  });
  ok('all nine real Zebrano lengths print as whole millimetres, none as a fractional foot',
    zLeaked.length === 0, zLeaked);

  // 🔴 THE ALARM FOR A CHANGE OF STORED PRECISION. At 2 dp a foot figure no longer
  // pins the millimetre, and the round trip silently stops recognising anything.
  const at2dp = [];
  for (let mm = 2400; mm <= 4500; mm += 300) {
    const ft = Number((mm / 304.8).toFixed(2));
    if (metricMmFromFeet(ft) === mm) at2dp.push([mm, ft]);
  }
  ok('a 2-dp foot figure is NOT silently accepted as that metric length', at2dp.length <= 1, at2dp);
}

// ---- SOUND. No imperial length may be relabelled in millimetres. Swept over every
// 1/16 of a foot from 1' to 40', which covers every fraction a mill prints.
{
  const whole = [];
  for (let n = 1; n <= 40; n++) whole.push(n);
  const leaked = whole.filter((n) => metricMmFromFeet(n) !== null);
  ok('no whole number of feet from 1 to 40 is read as metric', leaked.length === 0, leaked);
  // 25' is EXACTLY 7620mm and would round-trip; the integer refusal is what stops it,
  // so it is asserted by name.
  ok("25' is exactly 7620mm and is still refused, by the integer rule",
    25 * 304.8 === 7620 && metricMmFromFeet(25) === null, null);

  const sweep = [];
  for (let n = 16; n <= 640; n++) {
    const ft = n / 16;
    if (Number.isInteger(ft)) continue;
    if (metricMmFromFeet(ft) !== null) sweep.push([ft, metricMmFromFeet(ft)]);
  }
  // THE ONE KNOWN COLLISION, NAMED RATHER THAN HIDDEN. 2.625' is 2'7 1/2" = 800.1mm,
  // read as 800mm - 0.1mm out, on a length no packing list prints. If this list ever
  // grows, the rule has been loosened and that is worth knowing.
  ok('exactly one non-integer 1/16-foot value collides, and it is 2.625\' = 800.1mm',
    sweep.length === 1 && sweep[0][0] === 2.625 && sweep[0][1] === 800, sweep);

  // Fractional imperial lengths a mill would actually print.
  const fractional = [4.5, 7.5, 8.5, 10.5, 12.5, 16.5, 8.25, 9.75, 12.25, 7.875];
  const fLeaked = fractional.filter((ft) => metricMmFromFeet(ft) !== null);
  ok('half-, quarter- and eighth-foot imperial lengths are not read as metric', fLeaked.length === 0, fLeaked);
  ok('  ...and print exactly as archTally.ts would have printed them',
    fractional.every((ft) => lengthDisplayFt(ft).text === `${ft}'` && lengthDisplayFt(ft).gloss === ''), null);
  // 12.5' is EXACTLY 3810mm, which is why the step is not 10mm. It stays refused at
  // 50mm too (3810/50 = 76.2, not a whole number of steps), which is what made
  // widening the step from 100mm to 50mm free. See METRIC_STEP_MM's measured table.
  ok("12.5' is exactly 3810mm and is still refused at the 50mm step",
    12.5 * 304.8 === 3810 && metricMmFromFeet(12.5) === null, null);

  // 🔴 THE SOUNDNESS SWEEP THE STEP CHANGE RESTS ON, pinned so a future widening to
  // 25mm or 10mm fails here rather than in front of a trader. Measured 2026-09-10:
  // 100mm and 50mm both leak exactly ONE imperial value (2.625'); 25mm leaks 7 and
  // 10mm leaks 17, including 12.5' above.
  const sweepLeaked = [];
  for (let n = 16; n <= 40 * 16; n++) {
    const ft = Number((n / 16).toFixed(3));
    if (Number.isInteger(ft)) continue;
    if (metricMmFromFeet(ft) !== null) sweepLeaked.push(ft);
  }
  ok('sweeping every 1/16 foot from 1\' to 40\', exactly ONE is read as metric',
    sweepLeaked.length === 1, sweepLeaked);
  ok('  ...and it is the documented 2.625\' (2\'7 1/2" = 800.1mm), not something new',
    sweepLeaked[0] === 2.625, sweepLeaked);
}

// ---- the guards
{
  ok('null feet gives the em-dash row, not "nullmm"', lengthDisplayFt(null).text === '—', lengthDisplayFt(null));
  ok('undefined feet likewise', lengthDisplayFt(undefined).text === '—', lengthDisplayFt(undefined));
  ok('NaN likewise', lengthDisplayFt(NaN).text === '—', lengthDisplayFt(NaN));
  ok('zero is not a length', metricMmFromFeet(0) === null, metricMmFromFeet(0));
  ok('a negative figure is not a metric length', metricMmFromFeet(-7.874) === null, metricMmFromFeet(-7.874));
  ok('feetInchesLabel on a whole foot drops the inches', feetInchesLabel(8) === "8'", feetInchesLabel(8));
  // 11.99' is 143.88 inches, which rounds to 144 - the carry case.
  ok('the 12-inch carry becomes the next foot, never 11\'12"', feetInchesLabel(11.99) === "12'", feetInchesLabel(11.99));
}

// ---- ROW LABELS. A range row states no single length and must survive untouched.
{
  ok('a range row keeps the document\'s own label',
    lengthDisplayRow({ label: "12-14'", sortKey: 12 }).text === "12-14'",
    lengthDisplayRow({ label: "12-14'", sortKey: 12 }));
  ok('  ...and is not marked metric', lengthDisplayRow({ label: "12-14'", sortKey: 12 }).metric === false, null);
  ok('an unstated length keeps its em dash',
    lengthDisplayRow({ label: '—', sortKey: Number.POSITIVE_INFINITY }).text === '—', null);
  ok('a metric row is converted', lengthDisplayRow({ label: "7.874'", sortKey: 7.874 }).text === '2400mm', null);
  ok('an imperial row is passed straight through',
    lengthDisplayRow({ label: "8'", sortKey: 8 }).text === "8'", null);
  ok('a missing row does not throw', lengthDisplayRow(null).text === '—', null);
  // A metric-looking sortKey under a label that is not a plain foot figure must still
  // be refused: the label is the authority on what the row IS.
  ok('a metric sortKey under a range label is still refused',
    lengthDisplayRow({ label: "7.874-9.843'", sortKey: 7.874 }).metric === false, null);
}

// ---- END TO END over the three real documents, through the real reducer.
{
  const detail = toLengthDistribution(TALLY_DETAIL_PL.bundles).rows.map((r) => lengthDisplayRow(r));
  ok('all 8 detail-pl rows render as whole millimetres',
    detail.length === 8 && detail.every((d) => d.metric && /^\d+mm$/.test(d.text)),
    detail.map((d) => d.text));
  ok('  ...and none of them still shows a fractional foot',
    detail.every((d) => !/\.\d+'/.test(d.text)), detail.map((d) => d.text));
  ok('  ...each carrying a feet-and-inches gloss',
    detail.every((d) => /^\d+'(\d+")?$/.test(d.gloss)), detail.map((d) => d.gloss));

  for (const [name, doc] of [['314307', TALLY_314307], ['CHECHEN', TALLY_CHECHEN]]) {
    const rows = toLengthDistribution(doc.bundles).rows;
    const changed = rows.filter((r) => lengthDisplayRow(r).text !== r.label);
    ok(`${name} is an imperial document and is left byte-for-byte alone`, changed.length === 0,
      changed.map((r) => [r.label, lengthDisplayRow(r).text]));
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
