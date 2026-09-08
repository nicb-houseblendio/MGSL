/**
 * The two gates of the SO wizard's Items step, kept apart on purpose.
 *
 * In `existing` mode the cart shows the order's own lines (`existing: true`) next
 * to whatever the trader adds. Only the additions are ever WRITTEN: there is no
 * update path for a line already on the order, and dropping one records intent
 * only ("Nothing is removed in NetSuite"). So there are two different questions:
 *
 *   itemsStepOk  may the trader leave the Items step?   -> is anything in the cart
 *   canWrite     would pressing the final button write?  -> is anything NEW in it
 *
 * Until 2026-09-08 both ran on the writable count. Opening an order to edit it
 * therefore showed its lines in the cart while the footer said "Add at least one
 * lot" and Continue stayed dead, which is the screenshot Marc-Antoine sent. Gating
 * the STEP on the writable count also hid the real reason from the trader, who
 * never reached Review to read it.
 *
 * Pure so it can be tested: node cannot load a .tsx in this repo.
 */
export type OrderMode = 'new' | 'existing';

export interface OrderGateInput {
  mode: OrderMode;
  /** Every line in the cart, the order's own included. */
  lineCount: number;
  /** Lines that are not already on the order. Equals lineCount in `new` mode. */
  writableCount: number;
}

export interface OrderGate {
  /** The Items step may be left. */
  itemsStepOk: boolean;
  /** The final button would write at least one line. */
  canWrite: boolean;
  /** Why Continue is dead on the Items step, or null when it is not. */
  itemsHint: string | null;
  /**
   * Why the final button is dead when every step passed, or null. Only the
   * `existing` case can be here: the cart holds lines, none of them new.
   */
  reviewHint: string | null;
}

export const ADD_A_LOT = 'Add at least one lot';
export const NOTHING_NEW =
  'Nothing to write: every line shown is already on the order. Add a lot to update it.';

export const orderGate = ({ mode, lineCount, writableCount }: OrderGateInput): OrderGate => {
  const lines = Math.max(0, lineCount | 0);
  const writable = Math.max(0, Math.min(writableCount | 0, lines));
  const itemsStepOk = mode === 'existing' ? lines > 0 : writable > 0;
  const canWrite = writable > 0;
  return {
    itemsStepOk,
    canWrite,
    itemsHint: itemsStepOk ? null : ADD_A_LOT,
    reviewHint: itemsStepOk && !canWrite ? NOTHING_NEW : null,
  };
};
