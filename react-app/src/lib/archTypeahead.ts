/**
 * Type-ahead matching for the ARCH order wizard's pickers.
 *
 * 🔴 WHY THIS EXISTS, and it is a real defect rather than a preference. The
 * customer and ship-to fields were native `<select>` elements. A native select
 * DOES type-ahead: typing letters walks the highlighted option. What it cannot do
 * is show you the letters. The browser owns that buffer and never renders it, so
 * Marc-Antoine's report on 2026-09-08 is literally true of the control we shipped:
 * "Quand je tape certains caractères, je ne vois pas ce que j'ai tappé."
 *
 * It was worse than cosmetic on the customer field. A native select fires
 * `onChange` on EVERY keystroke of its own type-ahead, so typing "County Line"
 * SELECTED Cofer Bros on the "C" and started an address fetch for it before
 * walking on. `loadAddressesFor` already carries a last-request-wins guard written
 * for exactly that, and the comment there records the wizard showing one
 * customer's name above another customer's addresses. A text input selects once,
 * on commit, so the race stops being reachable.
 *
 * Everything here is pure. Node cannot load a `.tsx` in this repo, so the logic
 * that can be wrong lives in a `.ts` module with tests and the component keeps
 * only the wiring.
 */

/**
 * Search key for one string: diacritics folded away, lower case, whitespace
 * collapsed.
 *
 * 🔴 THE FOLDING IS LOAD-BEARING ON THIS ACCOUNT, not a nicety. The sandbox sales
 * reps include Léo Dupuis and Christian Labbé, the customers include Avantis
 * Coopérative, and the fixture ship-to cities are Montréal, Québec and
 * Trois-Rivières. A trader on an en-US keyboard types "leo", "labbe", "montreal".
 * A plain `toLowerCase().includes()` matches none of them, which is a picker that
 * looks broken on the very names this subsidiary sells under.
 */
export const foldForSearch = (s: string): string =>
  String(s == null ? '' : s)
    .normalize('NFD')
    // Combining marks. Stripping these AFTER NFD is what turns "é" into "e";
    // doing it on the composed string does nothing at all.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * How well a label matches a query, lower being better. -1 means no match.
 *
 * Three tiers rather than a boolean, because "84" against 807 customers has to
 * put "84 Lumber Company" above every name that merely contains an 84 somewhere,
 * and a trader typing "line" wants "County Line Materials" before "Airline
 * Supply". Prefix, then start-of-any-word, then anywhere.
 */
export const matchRank = (label: string, foldedQuery: string): number => {
  if (!foldedQuery) return 0;
  const hay = foldForSearch(label);
  if (!hay) return -1;
  if (hay.startsWith(foldedQuery)) return 0;
  // Word start. The separators are the ones these labels actually use: spaces,
  // commas, dashes, slashes, dots and ampersands.
  const words = hay.split(/[\s,\-/.&()]+/);
  for (let i = 1; i < words.length; i++) {
    if (words[i] && words[i].startsWith(foldedQuery)) return 1;
  }
  return hay.indexOf(foldedQuery) === -1 ? -1 : 2;
};

/**
 * The options a query should show, best match first.
 *
 * A BLANK QUERY RETURNS EVERYTHING IN THE ORIGINAL ORDER, and that is the whole
 * of the arrow affordance Marc-Antoine asked to keep: "en gardant la flèche comme
 * possibilité pour la recherche globale". The caret clears the query, so opening
 * the list without typing is the full list in the server's order.
 *
 * Ties keep their input order, so a stable server ordering stays stable on screen.
 */
export const filterTypeahead = <T>(
  options: readonly T[],
  query: string,
  labelOf: (o: T) => string
): T[] => {
  const q = foldForSearch(query);
  if (!q) return options.slice();
  const scored: { o: T; rank: number; i: number }[] = [];
  options.forEach((o, i) => {
    const rank = matchRank(labelOf(o), q);
    if (rank >= 0) scored.push({ o, rank, i });
  });
  scored.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.i - b.i));
  return scored.map((s) => s.o);
};

/**
 * Next highlighted index, wrapping. -1 in, and a downward move starts at the top.
 *
 * Wrapping rather than clamping because the lists here are long: 807 customers
 * means arrowing to the end and finding the keys dead is a worse answer than
 * coming back round.
 */
export const moveHighlight = (current: number, delta: number, len: number): number => {
  if (len <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : len - 1;
  return ((current + delta) % len + len) % len;
};

/**
 * The option a typed string stands for, or null.
 *
 * 🔴 EXACT MATCH ONLY, on the folded key. This is the guard that keeps the
 * combobox as safe as the select it replaces: `pickCustomerById` exists because
 * "resolving a typed name to a customer is how an order lands on the wrong
 * account, and 807 customers is more than enough for a near-match to look right".
 * A near match therefore resolves to NOTHING here, and the field reverts to
 * whatever was actually committed rather than guessing.
 */
export const resolveTyped = <T>(
  options: readonly T[],
  query: string,
  labelOf: (o: T) => string
): T | null => {
  const q = foldForSearch(query);
  if (!q) return null;
  const hit = options.find((o) => foldForSearch(labelOf(o)) === q);
  return hit === undefined ? null : hit;
};
