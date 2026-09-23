/**
 * Feedback 8, step 2.3: the ONE place a bundle with no stock is offered for sale,
 * and the badge a reserved bundle carries everywhere else.
 *
 * The order endpoint is the real gate (archReservation.test.mjs); these pin that
 * the screen offers exactly what the endpoint accepts, and locks what it refuses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isLotLocked, isReservableInTransit, reservationText, lockReason } from './archLots.ts';

const here = dirname(fileURLToPath(import.meta.url));
const WATER = { lotNo: 'HBRES-1', lotId: '52889', onHand: 0, inTransit: 100, onOrder: 0, reserve: 0, readyToBuild: 0, outbound: 0 };
const HELD = { soId: '130406', soNumber: 'SO-ARC-27', customer: 'Bell Forest Products Inc.', pending: false, since: '2026-09-23 01:10:00', landed: false, exception: null };

test('U1 a whole bundle on the water is reservable, and locked everywhere that sells on hand', () => {
  assert.equal(isReservableInTransit(WATER), true);
  assert.equal(isLotLocked(WATER), true, 'the On Hand / Available gates still refuse it');
});

test('U2 not reservable: still partly on order, landed, held, committed, or already reserved', () => {
  assert.equal(isReservableInTransit({ ...WATER, onOrder: 50 }), false);
  assert.equal(isReservableInTransit({ ...WATER, onHand: 100 }), false);
  assert.equal(isReservableInTransit({ ...WATER, onHold: true }), false);
  assert.equal(isReservableInTransit({ ...WATER, reserve: 10 }), false);
  assert.equal(isReservableInTransit({ ...WATER, reservation: HELD }), false);
  assert.equal(isReservableInTransit({ ...WATER, inTransit: 0, onOrder: 100 }), false, 'On Order is visibility only');
});

test('U3 a reserved bundle that LANDED is locked even before the reconciler assigns it', () => {
  const landed = { ...WATER, onHand: 100, inTransit: 0, reservation: { ...HELD, landed: true } };
  assert.equal(isLotLocked(landed), true);
  assert.match(lockReason(landed).detail, /Reserved on SO-ARC-27/);
});

test('U4 the badge names the order, and an exception replaces the plain text', () => {
  assert.equal(reservationText({ ...WATER, reservation: HELD }).badge, 'SO-ARC-27');
  const exc = { ...HELD, exception: { label: 'PO line closed or reduced', since: '2026-09-25' } };
  assert.match(reservationText({ ...WATER, reservation: exc }).badge, /PO line closed/);
  assert.match(reservationText({ ...WATER, reservation: { ...HELD, pending: true } }).badge, /Reserving/);
  assert.equal(reservationText(WATER), null);
});

const SRC = (p) => readFileSync(join(here, p), 'utf8');

test('U5 only the In Transit tab gets checkboxes; On Order stays visibility only', () => {
  const v = SRC('../components/arch/ArchPOListView.tsx');
  assert.match(v, /const selectable = bucket === 'inTransit' && !!onAddToCart;/);
  assert.match(v, /onAddToCart!\(tickedLots\.map\(\(l\) => l\.lotNo\), 'inTransit'\)/);
  assert.match(v, /isReservableInTransit\(lot\) && !inCart/);
});

test('U6 the drawer hands the cart to the In Transit view', () => {
  const d = SRC('../components/DetailDrawerARCH.tsx');
  assert.match(d, /<ArchPOListView[\s\S]{0,200}onAddToCart=\{onAddToCart \? \(lotNos, bucket\) => onAddToCart\(row, lotNos, bucket\) : undefined\}/);
});

test('U7 the wizard cannot send a split for a bundle on the water', () => {
  const w = SRC('../components/arch/SOWizard.tsx');
  assert.match(w, /isSplit: sp\(l\.key\)\.on && l\.bucket !== 'inTransit',/);
  assert.match(w, /disabled=\{l\.bucket === 'inTransit'\}/);
});
