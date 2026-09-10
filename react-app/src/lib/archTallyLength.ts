/**
 * How a tally LENGTH is printed on screen, when the document that stated it was metric.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * `mgsl.tally.v1` stores every length as `lengthFt`, a number of feet, and
 * `rowLabel()` in archTally.ts prints it as `${lengthFt}'`. That is right for the two
 * imperial packing lists we hold and wrong-looking for the metric one: measured
 * 2026-09-08, `detail pl inv 2026_00031.xlsx` renders as
 *
 *   7.874'  8.858'  9.843'  10.827'  11.811'  12.795'  13.78'  14.764'
 *
 * which is arithmetically correct and reads as noise. That single fact is what kept
 * the only multi-width document we own out of the demo rotation (see the headers of
 * archTallyDetailPL.ts and archTallyFixtures.ts), and keeping it out is why no lot on
 * the deployed screen could draw a width matrix at all - 0 of 67 real on-hand ARCH
 * lots, measured. So the label was the blocker, and it is fixed here rather than by
 * hiding the document.
 *
 * ── WHY THE UNIT IS RECOVERED AND NOT STORED ─────────────────────────────────
 * The structural fix is a `lengthUnit` beside `TallyMatrix.widthUnit`. That changes
 * the stored payload contract, the parsing skill that writes it and the generated
 * fixture, none of which are in this pass. So the unit is recovered instead, and the
 * recovery is a ROUND TRIP rather than a tolerance:
 *
 *   a foot figure is metric iff converting the nearest round metric length back to
 *   feet, at the 3 decimal places these payloads store, reproduces it EXACTLY.
 *
 * 7.874 is what 2400mm becomes at 3 dp, so 7.874 is 2400mm. 7.875 (7'10 1/2") is not
 * what any round metric length becomes, so it stays 7.875'. No epsilon is chosen and
 * nothing is "close enough": either the document's own figure is reproduced or the
 * label is left alone.
 *
 * MEASURED both directions, and both are pinned in archTallyLength.test.mjs:
 *   - COMPLETE. All 118 lengths from 300mm to 12000mm in 100mm steps round-trip.
 *   - SOUND. Sweeping every 1/16-foot value from 1' to 40', exactly ONE non-integer
 *     is read as metric: 2.625' (2'7 1/2") = 800.1mm, read as 800mm. It is 0.1mm out,
 *     which is nothing, and a 31 1/2-inch board is not a length any packing list
 *     prints. It is named in the test rather than papered over.
 *
 * Two further guards keep the sound side sound:
 *   - A WHOLE number of feet is refused outright. A document that printed 8 feet
 *     printed feet, whatever 8 x 304.8 lands near.
 *   - The metric step is 100mm, not 10mm. At 10mm the rule breaks: 12.5' is EXACTLY
 *     3810mm, so it round-trips perfectly and a half-foot imperial length would be
 *     relabelled in millimetres. Every length in the one metric document we hold is a
 *     multiple of 300mm, so 100mm loses nothing real; a supplier length that is not a
 *     multiple of 100mm simply prints as feet, which is the safe direction to fail.
 *
 * ⚠️ THIS IS A DISPLAY LAYER AND NOTHING ELSE. It never touches a number that is
 * summed, grouped or compared - `toLengthDistribution` still groups on rowLabel()'s
 * own string, and that string stays the React key. All this decides is what a human
 * reads in the Length column.
 */

/** Feet to millimetres. The international foot, exactly 304.8mm. */
const MM_PER_FT = 304.8;

/**
 * See the header: NOT 10, because 12.5' is exactly 3810mm.
 *
 * ⚠️ WIDENED FROM 100 TO 50 on 2026-09-10, and the reason is a real document.
 * `pl inv 01368.xlsx` and `pl inv 05513.xlsx` (Zebrano, FAS) state their lengths on a
 * FIFTY-millimetre grid: 2250, 2300, 2350, 2400, 2450, 2500, 2550, 2600, 2650. At a
 * 100mm step the odd ones do not round-trip, so five of those nine printed as
 * `7.382'` / `7.71'` / `8.038'` / `8.366'` / `8.694'` - the exact unreadable
 * fractional-foot output this whole file exists to prevent, and the thing
 * `archTallyReach.test.mjs` asserts against.
 *
 * MEASURED before changing it, sweeping every 1/16-foot value from 1' to 40' for
 * imperial lengths wrongly read as metric, and every grid length 300-12000mm for
 * failures to round-trip:
 *
 *   step   false-metric imperial   grid lengths failing round-trip
 *   100mm  1  (2.625' only)        0
 *    50mm  1  (2.625' only)        0
 *    25mm  7                       0
 *    10mm  17 (incl. 12.5')        0
 *
 * So 50mm is FREE: identical soundness to 100mm, the same single documented exception
 * (2.625' = 2'7 1/2" = 800.1mm, read as 800mm, 0.1mm out and not a length any packing
 * list prints), and it covers the real 50mm grid. 25mm and 10mm are where the rule
 * genuinely degrades, 10mm exactly as the header always said.
 */
const METRIC_STEP_MM = 50;

/**
 * The decimal places `lengthFt` is stored to across every payload and fixture. The
 * round trip is only as sharp as this, and 3 is what pins a length to the millimetre
 * (0.0005' = 0.15mm). If a generator ever writes 2 dp, the completeness assertions in
 * archTallyLength.test.mjs fail, which is the intended alarm.
 */
const STORED_DP = 3;

/**
 * The round metric length this foot figure came from, or null when it did not come
 * from one.
 */
export const metricMmFromFeet = (feet: number | null | undefined): number | null => {
  if (feet == null || !Number.isFinite(feet) || feet <= 0) return null;
  // Not a tolerance question: a whole number of feet is a document printing feet.
  if (Number.isInteger(feet)) return null;
  const step = Math.round((feet * MM_PER_FT) / METRIC_STEP_MM) * METRIC_STEP_MM;
  if (step <= 0) return null;
  const roundTrip = Number((step / MM_PER_FT).toFixed(STORED_DP));
  return roundTrip === feet ? step : null;
};

/**
 * `7'10"`, from a decimal foot figure. Whole feet drop the inches.
 *
 * Rounds TOTAL inches, so there is no 12-inch carry to get wrong: 11.811' is 141.73
 * inches, which rounds to 142 and formats as 11'10", never as 11'12".
 */
export const feetInchesLabel = (feet: number | null | undefined): string => {
  if (feet == null || !Number.isFinite(feet)) return '';
  const sign = feet < 0 ? '-' : '';
  const totalIn = Math.round(Math.abs(feet) * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  return inch === 0 ? `${sign}${ft}'` : `${sign}${ft}'${inch}"`;
};

export interface LengthDisplay {
  /** The figure to print. `2400mm` for a metric document, `8'` for an imperial one. */
  text: string;
  /**
   * The imperial reading to print beside it, muted, or '' when `text` is already
   * imperial. Never the primary figure: the document said 2400mm and 7'10" is ours.
   */
  gloss: string;
  /** True when the length was recognised as a round metric one. */
  metric: boolean;
}

/**
 * A single foot figure, as a trader should read it.
 *
 * A length that is not a recognisably metric one comes back exactly as archTally.ts
 * would have printed it, so imperial documents are untouched.
 */
export const lengthDisplayFt = (feet: number | null | undefined): LengthDisplay => {
  if (feet == null || !Number.isFinite(feet)) return { text: '—', gloss: '', metric: false };
  const mm = metricMmFromFeet(feet);
  if (mm == null) return { text: `${feet}'`, gloss: '', metric: false };
  return { text: `${mm}mm`, gloss: feetInchesLabel(feet), metric: true };
};

/** Only a single-value foot label may be reinterpreted. */
const SINGLE_FT_LABEL = /^\d+(?:\.\d+)?'$/;

/**
 * A `toLengthDistribution` row's Length cell.
 *
 * 🔴 A RANGE ROW IS LEFT ALONE. `rowLabel()` emits `12-14'` for a declared range and
 * `sortKey` is then only the range's START, so printing `3657mm` for it would state a
 * single length the document never gave. Same for the `—` row, whose length the
 * document did not state at all. Both fall through untouched, which is why this takes
 * the label and not just the number.
 */
export const lengthDisplayRow = (
  row: { label: string; sortKey: number } | null | undefined,
): LengthDisplay => {
  const label = row?.label ?? '—';
  if (!SINGLE_FT_LABEL.test(label)) return { text: label, gloss: '', metric: false };
  const d = lengthDisplayFt(row?.sortKey);
  // Belt and braces: if the numeric route did not recognise it, keep the document's
  // own label rather than a reconstruction of it.
  return d.metric ? d : { text: label, gloss: '', metric: false };
};
