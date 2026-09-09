/**
 * What the wizard is allowed to SAY about the $200 split fee.
 *
 * ── The client's own words, and the distinction that has been got wrong twice ─
 * Marc-Antoine's Slack checklist (`docs/CWP ARCH/Client feedback/Client - Slack
 * To Do.PNG`), under "Reman function → Génération de Journal Entries (JE) pour
 * refléter les coûts de remans qui s'ajoutent à la trade":
 *
 *     "Présentment 200$/split et 0.20$/mbf pour chaque reman."
 *     "Idéalement un UI qui permet de changer ces valeurs avec un Start/End."
 *
 * So the AMOUNT is his, in writing. What has never been answered is whether we
 * should APPLY it: it was put to Philippe with M-A tagged on 2026-09-02 as "Le
 * frais de 200 par split ... On l'active ou non?" and was still on the owed list
 * on 2026-09-04 ("Is the $200 split fee alive? BT5 v0.3 calls it confirmed, TS1
 * v0.5 says never confirmed, config default OFF, do not hard-code"). The amount
 * and the instruction to charge it are DIFFERENT FACTS, and collapsing them is
 * how a stale code comment once became a false claim about what the client said.
 *
 * ── Why this module exists at all ───────────────────────────────────────────
 * 🔴 The Pricing step asserted, unconditionally, that the fee "stays switched
 * off ... so a split line currently costs nothing in this margin". That sentence
 * is a fact about a script PARAMETER, not about the code:
 * `custscript_arch_split_fee_on` on deployment 1 of Suitelet 4719 (measured
 * read-only 2026-09-09: `F`, with `custscript_arch_split_fee_amt` empty). The
 * day MGSL tick that box, the margin starts deducting the fee while the step
 * that shows the margin says it does not. The fee must never be silently
 * included, and copy that contradicts the arithmetic is exactly that.
 *
 * THREE states, not two, because the two parameters are independent and the
 * amount is currently blank: ticking the box alone gives `splitFee() === 0`, so
 * "the $0 split fee comes from configuration" would be the third wrong sentence.
 *
 * Pure and tested: node cannot load the `.tsx` that renders these.
 */

export type SplitFeeState = 'off' | 'on' | 'onWithoutAmount';

/**
 * Which of the three the screen is actually in.
 *
 * `enabled` is `splitFeeEnabled()` — MCGI_CONFIG.splitFeeEnabled === true — and
 * `amount` is `splitFee()`, which already returns 0 whenever the switch is off.
 * A non-finite or negative amount is treated as no amount rather than trusted.
 */
export const splitFeeState = (enabled: boolean, amount: number): SplitFeeState => {
  if (!enabled) return 'off';
  return Number.isFinite(amount) && amount > 0 ? 'on' : 'onWithoutAmount';
};

/** Money for prose: `$200`, `$200.50`. Whole amounts keep no decimals. */
const money = (n: number): string =>
  '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * The sentence for the Pricing and Review steps, where a margin is on screen.
 *
 * Every branch says what the MARGIN does, because that is the number the trader
 * prices against and the thing the reader needs to be able to trust.
 *
 * `quoted` is the amount MGSL quoted (SPLIT_FEE_PLACEHOLDER, 200) and is only
 * used in the 'off' and 'onWithoutAmount' branches: once a real amount is
 * configured, the configured one is the truth and the quote is history.
 */
export const splitFeeMarginSentence = (
  state: SplitFeeState,
  amount: number,
  quoted: number
): string => {
  if (state === 'on') {
    return (
      'The split fee IS applied: ' +
      money(amount) +
      ' per split line is deducted in this margin, from configuration. MGSL quoted ' +
      money(quoted) +
      ' per split.'
    );
  }
  if (state === 'onWithoutAmount') {
    return (
      'The split fee is switched ON but no amount is configured, so a split line still ' +
      'costs nothing in this margin. Set the amount on the trader-screen deployment, or ' +
      'switch the fee off — MGSL quoted ' +
      money(quoted) +
      ' per split.'
    );
  }
  return (
    'The one rate not applied here is the split fee: MGSL quote ' +
    money(quoted) +
    ' per split, but it stays switched off until they ask for it, so a split line ' +
    'currently costs nothing in this margin.'
  );
};

/**
 * The shorter sentence for the Bundle split step, where there is no margin yet
 * and the trader is deciding whether to split at all.
 */
export const splitFeeStepSentence = (
  state: SplitFeeState,
  amount: number,
  quoted: number
): string => {
  if (state === 'on') {
    return money(amount) + ' per split is charged against the trade, from configuration.';
  }
  if (state === 'onWithoutAmount') {
    return (
      'The split fee is switched on with no amount configured, so nothing is charged. ' +
      'MGSL quote ' +
      money(quoted) +
      ' per split.'
    );
  }
  return (
    'No split fee is charged yet. MGSL quote ' +
    money(quoted) +
    ' per split, but it stays off until they ask for it to be applied.'
  );
};

/**
 * The per-line badge on the split step: "+$200" only when it is really charged.
 * Null in both other states, so nothing implies a charge that is not made.
 */
export const splitFeeBadge = (state: SplitFeeState, amount: number): string | null =>
  state === 'on' ? '+' + money(amount) : null;

/**
 * The "Services =" formula line under the Pricing table.
 *
 * Reads `0` rather than an amount whenever nothing is charged, INCLUDING the
 * half-configured state, so the formula and the arithmetic cannot disagree.
 */
export const splitFeeFormulaAmount = (state: SplitFeeState, amount: number): number =>
  state === 'on' ? amount : 0;
