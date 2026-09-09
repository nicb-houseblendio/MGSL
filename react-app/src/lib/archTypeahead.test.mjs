/**
 * Type-ahead matching for the ARCH wizard's customer and ship-to pickers.
 *
 * Every case here is a name that exists in the MGSL sandbox or in the ARCH
 * fixtures, because the point of the module is that a trader on an en-US keyboard
 * can find "Léo Dupuis" and "Avantis Coopérative".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foldForSearch,
  matchRank,
  filterTypeahead,
  moveHighlight,
  resolveTyped,
} from './archTypeahead.ts';

/** Real sandbox customers, in the order `action=customers` returns them. */
const CUSTOMERS = [
  '2K Wholesale Inc',
  '40 West Corporation',
  '84 Lumber Company',
  'Ab Martin Roofing Supply LLC',
  'Avantis Coopérative',
  'Cofer Bros Inc.',
  'County Line Materials LLC',
  'D L Truss LLC',
  'Myrtle Beach Building Supply dba US LBM',
];
const label = (s) => s;

test('foldForSearch strips diacritics, lowercases and collapses space', () => {
  assert.equal(foldForSearch('Léo Dupuis'), 'leo dupuis');
  assert.equal(foldForSearch('Avantis Coopérative'), 'avantis cooperative');
  assert.equal(foldForSearch('Christian  Labbé '), 'christian labbe');
  assert.equal(foldForSearch('Trois-Rivières QC'), 'trois-rivieres qc');
  assert.equal(foldForSearch(''), '');
  assert.equal(foldForSearch(null), '');
  assert.equal(foldForSearch(undefined), '');
});

test('an accent-free query finds an accented name', () => {
  assert.deepEqual(filterTypeahead(CUSTOMERS, 'cooperative', label), ['Avantis Coopérative']);
  assert.deepEqual(filterTypeahead(['Léo Dupuis', 'Alec Wolf'], 'leo', label), ['Léo Dupuis']);
  assert.deepEqual(filterTypeahead(['Christian Labbé'], 'labbe', label), ['Christian Labbé']);
});

test('the accented query still finds the accented name', () => {
  assert.deepEqual(filterTypeahead(CUSTOMERS, 'Coopérative', label), ['Avantis Coopérative']);
});

test('a blank query is the whole list in its original order', () => {
  assert.deepEqual(filterTypeahead(CUSTOMERS, '', label), CUSTOMERS);
  assert.deepEqual(filterTypeahead(CUSTOMERS, '   ', label), CUSTOMERS);
});

test('prefix beats word-start beats contains', () => {
  assert.equal(matchRank('84 Lumber Company', '84'), 0);
  assert.equal(matchRank('County Line Materials LLC', 'line'), 1);
  assert.equal(matchRank('Ab Martin Roofing Supply LLC', 'oofing'), 2);
  assert.equal(matchRank('2K Wholesale Inc', 'zzz'), -1);
  // Ranked, not merely filtered: a prefix hit must outrank a mid-word hit.
  assert.deepEqual(
    filterTypeahead(['Airline Supply', 'Line Drive Lumber'], 'line', label),
    ['Line Drive Lumber', 'Airline Supply']
  );
});

test('ties keep the server order', () => {
  const rows = ['Cofer Bros Inc.', 'County Line Materials LLC'];
  assert.deepEqual(filterTypeahead(rows, 'co', label), rows);
});

test('matching is on the label, so a hint cannot smuggle a match in', () => {
  const rows = [{ label: 'D L Truss LLC', hint: 'US Dollar' }];
  assert.deepEqual(filterTypeahead(rows, 'dollar', (o) => o.label), []);
});

test('moveHighlight wraps and starts from the top', () => {
  assert.equal(moveHighlight(-1, 1, 5), 0);
  assert.equal(moveHighlight(-1, -1, 5), 4);
  assert.equal(moveHighlight(4, 1, 5), 0);
  assert.equal(moveHighlight(0, -1, 5), 4);
  assert.equal(moveHighlight(2, 1, 5), 3);
  assert.equal(moveHighlight(0, 1, 0), -1);
  assert.equal(moveHighlight(-1, 1, 0), -1);
});

test('resolveTyped is exact only, so a near match resolves to nothing', () => {
  // The guard that keeps the combobox as safe as the select: a typed name must
  // never be inferred onto a customer.
  assert.equal(resolveTyped(CUSTOMERS, 'County Line', label), null);
  assert.equal(resolveTyped(CUSTOMERS, 'County Line Materials LLC', label), 'County Line Materials LLC');
  // Case and accents fold, because those are the same name.
  assert.equal(resolveTyped(CUSTOMERS, 'avantis cooperative', label), 'Avantis Coopérative');
  assert.equal(resolveTyped(CUSTOMERS, '', label), null);
});
