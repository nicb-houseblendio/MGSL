/**
 * Trader display helpers, shared by the warehouse split queue and the Open Sales
 * Orders tab. Both group by trader and both show the same avatar.
 */

/** First name only. These lists are dense and surnames add nothing. */
export const traderShortName = (trader: string): string => (trader || '').split(' ')[0] || '—';

export const traderInitials = (trader: string): string =>
  (trader || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

/**
 * Avatar colours, assigned so no two traders in the same list collide.
 *
 * A pure name hash was the first attempt and it failed immediately on the real
 * roster: Christopher Pajot and Melissa De Castro both landed on #15803D, so two
 * of four traders were indistinguishable on a screen whose entire job is "whose
 * order is this". Assigning by position in the sorted roster guarantees
 * distinctness up to palette size, and sorting keeps the mapping stable when the
 * list is filtered or reordered.
 */
const AVATAR_PALETTE = [
  '#B91C1C',
  '#15803D',
  '#1D4ED8',
  '#A16207',
  '#7E22CE',
  '#0F766E',
  '#BE185D',
  '#0369A1',
];

export const traderColorMap = (traders: string[]): Record<string, string> => {
  const roster = [...new Set(traders.filter(Boolean))].sort();
  const map: Record<string, string> = {};
  roster.forEach((t, i) => {
    map[t] = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
  });
  return map;
};
