/**
 * Feedback 10, 2026-09-17. Marc-Antoine: « Si un montant est entré, ça ajoute une
 * ligne sur le SO item Milling Charges ... La description pourrait être du genre
 * Planing (Dressed thickness) & cut (target length) ». Built and proven live on
 * SO-ARC-26 on 2026-09-22, except the description: that line has none, because
 * the wizard never built one and `archOrderApi` dropped the field anyway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { millingDescription } from './archOrderPricing.ts';

const here = dirname(fileURLToPath(import.meta.url));
const wiz = readFileSync(join(here, '../components/arch/SOWizard.tsx'), 'utf8');
const api = readFileSync(join(here, './archOrderApi.ts'), 'utf8');
const L = (o) => ({ planing: false, planingSpec: '', planingOther: '', cutting: false, cutLength: '', ...o });

test('his format, with the step values in the brackets', () => {
  assert.equal(millingDescription([L({ planing: true, planingSpec: '13/16', cutting: true, cutLength: "8'" })]),
    'Planing (13/16") & cut (8\')');
});

test('distinct values only, first-seen order, "other" reads the typed size', () => {
  assert.equal(millingDescription([
    L({ planing: true, planingSpec: '13/16', cutting: true, cutLength: "8'" }),
    L({ planing: true, planingSpec: '13/16', cutting: true, cutLength: "10'" }),
    L({ planing: true, planingSpec: 'other', planingOther: ' 2-1/8 ' }),
  ]), 'Planing (13/16", 2-1/8") & cut (8\', 10\')');
});

test('one service alone, a service with no value, and a flat fee', () => {
  assert.equal(millingDescription([L({ cutting: true, cutLength: "9'" })]), "Cut (9')");
  assert.equal(millingDescription([L({ planing: true, planingSpec: '1-1/16' })]), 'Planing (1-1/16")');
  assert.equal(millingDescription([L({ planing: true, planingSpec: 'other', planingOther: '' })]), 'Planing');
  assert.equal(millingDescription([L({})]), '');
  assert.equal(millingDescription([]), '');
});

test('the wizard builds it from the CHARGED lines and puts it on the milling line', () => {
  assert.match(wiz, /const description = millingDescription\(\s*writableLines\s*\.filter\(\(l\) => parseFloat\(millingCharge\[l\.key\] \|\| ''\) > 0\)\s*\.map\(\(l\) => rm\(l\.key\)\)\s*\);/);
  assert.match(wiz, /rate: millingTotal,\s*\.\.\.\(description \? \{ description \} : \{\}\),/);
});

test('the request builder no longer drops a charge description', () => {
  assert.match(api, /\.\.\.\(c\.description \? \{ description: c\.description \} : \{\}\),/);
});
