/**
 * Feedback 15, 2026-09-22. Andrei told Marc-Antoine « On met le standard pour les
 * épaisseurs, 4/4 donne 13/16, 5/4 donne 1-1/16, 6/4 donne 1-5/16, 8/4 donne
 * 1-3/4, et on ajoute le 9 pieds », and he answered « Garde comme ça dans le code
 * pour l'instant. Petite note : le apply all ne suit pas les mêmes options ».
 * The code still ran a placeholder formula (5/4 never offered 1-1/16), had no 9',
 * and the apply-all bar offered Light/Standard/Heavy "% off" levels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { planingOptions, STANDARD_DRESSED, nominalQuarters } from './archOrderPricing.ts';

const here = dirname(fileURLToPath(import.meta.url));
const wiz = readFileSync(join(here, '../components/arch/SOWizard.tsx'), 'utf8');

test('the standard dressed size per thickness is exactly what MA was told', () => {
  assert.deepEqual({ ...STANDARD_DRESSED }, { '4/4': '13/16', '5/4': '1-1/16', '6/4': '1-5/16', '8/4': '1-3/4' });
  assert.deepEqual(planingOptions('4/4'), ['13/16', 'other']);
  assert.deepEqual(planingOptions('5/4'), ['1-1/16', 'other']);
  assert.deepEqual(planingOptions('6/4'), ['1-5/16', 'other']);
  assert.deepEqual(planingOptions('8/4'), ['1-3/4', 'other']);
});

test('the thickness is found in a description too, and 10/4 or 12/4 offer Other only', () => {
  assert.deepEqual(planingOptions('Sapele 6/4 KD'), ['1-5/16', 'other']);
  assert.equal(nominalQuarters('Bocote 5/4 KD'), '5/4');
  assert.deepEqual(planingOptions('10/4'), ['other']);
  assert.deepEqual(planingOptions('12/4'), ['other']);
  assert.deepEqual(planingOptions(''), ['other']);
  // "14/4" must not be read as "4/4"
  assert.equal(nominalQuarters('14/4'), '14/4');
});

test('apply-all offers the SAME choice the lines do: the standard size, resolved per line', () => {
  assert.doesNotMatch(wiz, /Light \(≈4% off\)|Heavy \(≈20% off\)/);
  assert.match(wiz, /const BULK_PLANING_LEVELS = \[\s*`Standard size \(\$\{Object\.entries\(STANDARD_DRESSED\)/);
  // applyBulkReman writes opts[idx] from planingOptions, never "other"
  assert.match(wiz, /const opts = planingOptions\(l\.thickness \|\| l\.description\);\s*\n\s*const idx = parseInt\(bulkReman\.planingLevel, 10\);/);
  assert.match(wiz, /opts\[idx\] && opts\[idx\] !== 'other'/);
});

test("9' is a cut length, and apply-all and the lines share the list", () => {
  assert.match(wiz, /const CUT_LENGTHS = \["6'", "7'", "8'", "9'", "10'", "12'", "14'", "16'"\];/);
  assert.equal((wiz.match(/\{CUT_LENGTHS\.map\(/g) || []).length, 2);
});
