/**
 * Which step of the order wizard the trader is allowed to click straight to.
 *
 * Marc-Antoine, 2026-09-14: "Est-ce qu'on pourrait 'cliquer' sur les tabs pour
 * retourner à une section vs de devoir absoluement cliquer sur 'back' et ou
 * continue lors de la création du SO".
 *
 * The rail could already go BACKWARDS. What it could not do is come forward
 * again, so a trader who jumped from Review to Customer to fix one field had to
 * press Continue four times to get back to where they were. That is the trip
 * this rule removes.
 *
 * 🔴 It invents no new permission. A forward jump is allowed exactly when
 * pressing Continue repeatedly would have been allowed, which is why every step
 * before the target has to be valid rather than just the current one. Review can
 * therefore never be reached over an invalid Pricing step, which is the property
 * the old "backwards only" rule was protecting.
 */

/**
 * @param from   the step the trader is on
 * @param to     the step they clicked
 * @param valid  per-step validity, in step order, same source as the Continue button
 */
export const canJumpToStep = (from: number, to: number, valid: boolean[]): boolean => {
  const count = Array.isArray(valid) ? valid.length : 0;
  if (count === 0) return false;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (to < 0 || to >= count) return false;

  // Standing still is not a jump. Returning false keeps the current step out of
  // the "clickable" styling, so the rail does not look like it does nothing.
  if (to === from) return false;

  // Backwards is always open, even from an invalid step. A trader who cannot
  // satisfy Pricing has to be able to reach the step that would fix it.
  if (to < from) return true;

  for (let i = 0; i < to; i += 1) {
    if (!valid[i]) return false;
  }
  return true;
};

/** The first step that blocks a forward jump, or -1 when none does. */
export const firstBlockingStep = (to: number, valid: boolean[]): number => {
  const count = Array.isArray(valid) ? valid.length : 0;
  for (let i = 0; i < Math.min(to, count); i += 1) {
    if (!valid[i]) return i;
  }
  return -1;
};
