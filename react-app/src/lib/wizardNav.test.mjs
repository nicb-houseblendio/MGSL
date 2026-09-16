/**
 * Step rail navigation. The seven steps are Start, Items, Customer & terms,
 * Bundle split, Remanufacturing, Pricing, Review, indices 0 to 6.
 */
import { canJumpToStep, firstBlockingStep } from './wizardNav.ts';

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

const ALL_OK = [true, true, true, true, true, true, true];
/** Pricing empty, which is the everyday case: no price typed yet. */
const PRICE_BAD = [true, true, true, true, true, false, true];
/** Customer & terms incomplete, the other everyday one. */
const CUSTOMER_BAD = [true, true, false, true, true, true, true];

/* The trip Marc-Antoine described: Review, back to Customer, forward again. */
ok('Review to Customer & terms is allowed', canJumpToStep(6, 2, ALL_OK));
ok('and Customer & terms back to Review in one click', canJumpToStep(2, 6, ALL_OK));
ok('one step forward is allowed when everything before it is valid', canJumpToStep(2, 3, ALL_OK));

/* Backwards never asks for validity, or a trader could be trapped on a step
 * they cannot satisfy. */
ok('backwards from an invalid Pricing step still works', canJumpToStep(5, 1, PRICE_BAD));
ok('backwards from Review with a broken Customer step still works', canJumpToStep(6, 0, CUSTOMER_BAD));

/* Forwards is exactly what Continue would have allowed, no more. */
ok('🔴 Review cannot be reached over an empty Pricing step', canJumpToStep(1, 6, PRICE_BAD) === false);
ok('🔴 nor can Pricing be reached over an incomplete Customer step', canJumpToStep(1, 5, CUSTOMER_BAD) === false);
ok('the invalid step itself is still reachable, which is how it gets fixed',
  canJumpToStep(1, 5, PRICE_BAD) === true);
ok('a step after the invalid one is not', canJumpToStep(1, 6, PRICE_BAD) === false);

/* Standing still is not a jump, so the current step is not styled as clickable. */
ok('clicking the step you are on does nothing', canJumpToStep(3, 3, ALL_OK) === false);

/* Bounds. The rail is generated from a constant list, but a stale index after a
 * step is added or removed must not throw or silently pass. */
ok('a negative target is refused', canJumpToStep(3, -1, ALL_OK) === false);
ok('a target past the last step is refused', canJumpToStep(3, 7, ALL_OK) === false);
ok('an empty validity list refuses everything', canJumpToStep(0, 1, []) === false);
ok('a non-integer index is refused', canJumpToStep(0, 1.5, ALL_OK) === false);
ok('a missing validity list does not throw', canJumpToStep(0, 1, undefined) === false);

/* The reason, for the tooltip. */
ok('the blocking step is named', firstBlockingStep(6, PRICE_BAD) === 5);
ok('the first blocker wins when there are two',
  firstBlockingStep(6, [true, false, false, true, true, true, true]) === 1);
ok('no blocker reads as -1', firstBlockingStep(6, ALL_OK) === -1);
ok('a step before the blocker is unblocked', firstBlockingStep(3, PRICE_BAD) === -1);

console.log(fail ? ('# FAIL ' + fail) : '# wizardNav ok');
process.exit(fail ? 1 : 0);
